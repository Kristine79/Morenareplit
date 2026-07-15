/**
 * Telegram-бот "Morena VPN"
 * Стек: grammY + Prisma (SQLite) + RoyaltyKey API + CryptoBot Pay + Platega.io
 *
 * Структура:
 *  - /start — приветствие + реферальная система
 *  - Главное меню: тест, покупка, профиль, промокод, инструкция
 *  - Покупка: тарифы → QR-инвойс → фоновая проверка → выдача ключа
 *    Способы оплаты: CryptoBot (USDT), Telegram Stars, Platega (Карта РФ, СБП)
 *  - Профиль: баланс, реферальная ссылка, список ключей
 *  - Промокоды: ввод + транзакция начисления бонуса
 *  - CRON: авто-уведомления об истечении
 */

import "dotenv/config";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import QRCode from "qrcode";
import { prisma } from "./db.js";
import { royaltyKey } from "./royaltyKeyApi.js";
import { cryptoBot, USDT_RUB_RATE } from "./cryptoBotApi.js";
import { platega, PLATEGA_METHOD } from "./platega.js";
import { CLASSIC_TARIFFS, OBHOD_TARIFFS, TARIFFS, TRIAL_TARIFF_ID, TRIAL_DURATION_DAYS, TRIAL_API_TARIFF, TRIAL_API_DAYS, REFERRAL_BONUS, EXTRA_TRAFFIC_PACKAGES } from "./tariffs.js";
import { escapeMarkdown, formatVpnKey, formatDate, subStatus } from "./helpers.js";

const plategaCb = new Map<string, Record<string, string>>();
let plategaCbId = 0;
function plategaCbSet(data: Record<string, string>): string {
  const key = String(++plategaCbId);
  plategaCb.set(key, data);
  setTimeout(() => plategaCb.delete(key), 3_600_000); // auto-clean after 1h
  return key;
}

export function setupBotHandlers(bot: Bot): void {
  const POLL_INTERVAL_MS = 7000;
  const POLL_MAX_MS = 3600000;
  const FALLBACK_DURATION_DAYS = 30;

  function mainMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text("🔮 Испытать магию (Тест 24ч)", "trial").row()
      .text("💎 Обрести силу (Купить)", "buy").row()
      .text("🏯 Личный чертог", "profile")
      .text("🎁 Подарить подписку", "gift").row()
      .text("📜 Активировать свиток", "promo")
      .text("📖 Книга заклинаний", "howto").row()
      .text("🤖 Полезные боты", "useful_bots")
      .text("🆘 Призвать помощь", "help")
      .row()
      .url("📢 Наш канал", "https://t.me/morenavpnnews").row();
  }

  const promoMode = new Set<number>();
  const giftState = new Map<number, { tariffId: string; step: "awaiting_recipient" }>();

  function mainMenuText(): string {
    return (
      `🌙 *Добро пожаловать в чертоги Morena VPN\\!*\n\n` +
      `Здесь живет древняя цифровая магия, которая обеспечивает абсолютную стабильность связи\\. Наш софт работает в режиме «цифрового камуфляжа» на базе протокола VLESS, гарантируя непрерывный доступ к важным ресурсам и защиту от любых сетевых штормов\\.\n\n` +
      `⚡️ Сверхбыстрые каналы до 10 Гбит/с — стриминг в 4K и игры без задержек\\.\n` +
      `🛡 Полная анонимность, индивидуальные ключи и защищенный DNS без логирования\\.\n` +
      `🌍 8 суверенных локаций в Европе и Азии в один клик\\.\n\n` +
      `Выберите действие, странник 👇`
    );
  }

  bot.command("start", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;

    const userId = BigInt(tgUser.id);
    const args = ctx.match;

    let user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      let referredById: bigint | null = null;

      if (args && args.startsWith("ref_")) {
        let refId: bigint | null = null;
        if (args?.startsWith("ref_")) {
          try {
            refId = BigInt(args.slice(4));
          } catch { /* ignore malformed */ }
        }
        if (refId !== null && refId !== userId) {
          const referrer = await prisma.user.findUnique({ where: { id: refId } });
          if (referrer) {
            referredById = refId;

            await prisma.user.upsert({
              where: { id: refId },
              update: { balance: { increment: REFERRAL_BONUS } },
              create: { id: refId, balance: REFERRAL_BONUS },
            });

            try {
              await bot.api.sendMessage(
                refId.toString(),
                `🎉 По вашей реферальной ссылке зарегистрировался новый пользователь!`,
                { parse_mode: "MarkdownV2" }
              );
            } catch (err) {
              console.warn(`[start] Не удалось уведомить реферера ${refId}:`, err);
            }
          }
        }
      }

      await prisma.user.create({
        data: {
          id: userId,
          username: tgUser.username ?? null,
          referredById,
        },
      });
    }

    if (args && args.startsWith("renew_")) {
      const subId = args.slice(6);
      await showRenewalOptions(ctx, subId);
      return;
    }

    await ctx.reply(mainMenuText(), {
      parse_mode: "MarkdownV2",
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.callbackQuery("trial", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = BigInt(ctx.from.id);

    const alreadyUsed = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user?.hasUsedTrial) return true;
      await tx.user.upsert({
        where: { id: userId },
        create: { id: userId, username: ctx.from?.username ?? null, hasUsedTrial: true },
        update: { hasUsedTrial: true },
      });
      return false;
    });

    if (alreadyUsed) {
      await ctx.reply(
        `⛔ Вы уже использовали пробный период\\.\n\nПриобретите подписку, чтобы продолжить пользоваться Morena VPN\\.`,
        { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("⚡ Купить", "buy") }
      );
      return;
    }

    await ctx.reply("⏳ Активируем ваш пробный доступ...");

    try {
      // Step 1: Create VPN user
      const vpnUser = await royaltyKey.createUser();

      // Step 2: Add trial subscription (1 day regular)
      const subResult = await royaltyKey.addSubscription(vpnUser.uuid, TRIAL_API_DAYS, TRIAL_API_TARIFF);

      const expiresAt = new Date(Date.now() + TRIAL_DURATION_DAYS * 86400000);
      await prisma.subscription.create({
        data: {
          id: vpnUser.uuid,
          telegramUserId: userId,
          vpnKey: vpnUser.subscription_url,
          tariffId: TRIAL_TARIFF_ID,
          expiresAt,
        },
      });

      const trialSiteUrl = `https://autoconnect-chi.vercel.app/?key=${encodeURIComponent(vpnUser.subscription_url)}`;
      await ctx.reply(formatVpnKey(vpnUser.subscription_url), {
        parse_mode: "MarkdownV2",
        reply_markup: new InlineKeyboard()
          .url("🚀 Автоподключение", trialSiteUrl)
          .row()
          .text("ℹ️ Инструкция", "howto"),
      });
    } catch (err) {
      // Откатываем флаг, т.к. создание ключа или подписки не удалось
      await prisma.user.upsert({
        where: { id: userId },
        update: { hasUsedTrial: false },
        create: { id: userId, hasUsedTrial: false },
      });
      console.error("[trial] Ошибка активации тестового доступа:", err);
      await ctx.reply("❌ Не удалось активировать тестовый доступ. Попробуйте позже или обратитесь в поддержку.");
    }
  });

  bot.callbackQuery("buy", async (ctx) => {
    await ctx.answerCallbackQuery();
    const text =
      `*Выберите тип тарифа*\n\n` +
      `🌟 *Тариф — Классик*\n` +
      `Скоростные сервера 10 Гбит, без ограничений и лимитов\\.\n\n` +
      `🌌 *Тариф — Цифровой камуфляж*\n` +
      `Специализированные серверы с технологией цифрового камуфляжа, гарантирующие стабильный доступ к важным ресурсам в любом регионе\\.\n\n` +
      `Выберите желаемый тариф:`;

    const keyboard = new InlineKeyboard()
      .text("🌟 Классик", "buy_type:classic").row()
      .text("🌌 Цифровой камуфляж", "buy_type:obhod").row()
      .text("◀️ Назад", "menu");

    await ctx.reply(text, {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^buy_type:(classic|obhod)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const type = ctx.match[1];
    const userId = BigInt(ctx.from.id);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const bonus = user?.balance ?? 0;

    const tariffs = type === "classic" ? CLASSIC_TARIFFS : OBHOD_TARIFFS;
    const label = type === "classic" ? "🌟 Классик" : "🌌 Цифровой камуфляж";

    const keyboard = new InlineKeyboard();
    for (const tariff of tariffs) {
      const finalPrice = Math.max(0, tariff.priceRub - bonus);
      const usdtPrice = (finalPrice / USDT_RUB_RATE).toFixed(2);
      const priceText =
        bonus > 0
          ? `${tariff.label} — ${usdtPrice} USDT (скидка ${Math.min(bonus, tariff.priceRub)} ₽)`
          : `${tariff.label}`;
      keyboard.text(priceText, `buy_tariff:${tariff.id}`).row();
    }
    keyboard.text("◀️ Назад", "buy");

    const bonusText =
      bonus > 0
        ? escapeMarkdown(`\n\n💰 У вас ${bonus} ₽ бонуса — скидка применена автоматически.`)
        : "";

    await ctx.reply(`*${label}*\n\n⚡ Выберите тариф:${bonusText}`, {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^buy_tariff:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tariffId = ctx.match[1];

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) {
      await ctx.reply("❌ Тариф не найден.");
      return;
    }

    const keyboard = new InlineKeyboard()
      .text("⚡ CryptoBot (USDT)", `pay_crypto:${tariffId}`).row()
      .text("⭐ Telegram Stars", `pay_stars:${tariffId}`).row()
      .text("💳 Картой (РФ)", `pay_card:${tariffId}`).row()
      .text("📲 СБП", `pay_sbp:${tariffId}`).row()
      .text("◀️ Назад", "buy");

    await ctx.reply(
      `📦 *${escapeMarkdown(tariff.label)}*\n\nВыберите способ оплаты:`,
      { parse_mode: "MarkdownV2", reply_markup: keyboard }
    );
  });

  bot.callbackQuery("gift", async (ctx) => {
    await ctx.answerCallbackQuery();
    const text =
      `🎁 *Подарить подписку*\n\n` +
      `🌟 *Тариф — Классик*\n` +
      `Скоростные серверы 10 Гбит, без ограничений и лимитов\\.\n\n` +
      `🌌 *Тариф — Цифровой камуфляж*\n` +
      `Специализированные серверы с технологией цифрового камуфляжа, гарантирующие стабильный доступ к важным ресурсам в любом регионе\\.\n\n` +
      `Выберите желаемый тариф:`;

    const keyboard = new InlineKeyboard()
      .text("🌟 Классик", "gift_type:classic").row()
      .text("🌌 Цифровой камуфляж", "gift_type:obhod").row()
      .text("◀️ Назад", "menu");

    await ctx.reply(text, {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^gift_type:(classic|obhod)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const type = ctx.match[1];

    const tariffs = type === "classic" ? CLASSIC_TARIFFS : OBHOD_TARIFFS;
    const label = type === "classic" ? "🌟 Классик" : "🌌 Цифровой камуфляж";

    const keyboard = new InlineKeyboard();
    for (const tariff of tariffs) {
      const usdtPrice = (tariff.priceRub / USDT_RUB_RATE).toFixed(2);
      keyboard.text(`${tariff.label} — ${usdtPrice} USDT`, `gift_tariff:${tariff.id}`).row();
    }
    keyboard.text("◀️ Назад", "gift");

    await ctx.reply(`*${label}*\n\n⚡ Выберите тариф:`, {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^gift_tariff:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tariffId = ctx.match[1];
    giftState.set(ctx.from.id, { tariffId, step: "awaiting_recipient" });
    await ctx.reply(
      `🎁 Отправьте username пользователя, которому хотите подарить подписку\\.\n\nПример: \`@username\``,
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.callbackQuery(/^gift_pay_crypto:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tariffId = ctx.match[1];
    const recipient = ctx.match[2];
    const senderId = BigInt(ctx.from.id);

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const finalPrice = tariff.priceRub;
    await ctx.reply("⏳ Создаём счёт...");

    try {
      const payload = `gift:${recipient}:${tariffId}:${senderId}`;
      const invoice = await cryptoBot.createCryptoInvoice(finalPrice, payload);
      const usdtAmount = (finalPrice / USDT_RUB_RATE).toFixed(2);

      const qrBuffer = await QRCode.toBuffer(invoice.pay_url, {
        type: "png", margin: 2, width: 512,
        color: { dark: "#1a1a2e", light: "#ffffff" },
      });

      await ctx.replyWithPhoto(new InputFile(qrBuffer, "qr.png"), {
        caption:
          `🎁 *Подарок для @${recipient}*\n\n` +
          `📦 *${escapeMarkdown(tariff.label)}*\n` +
          `💰 Сумма: *${escapeMarkdown(usdtAmount)} USDT*\n\n` +
          `Оплатите USDT через CryptoBot\\.`,
        parse_mode: "MarkdownV2",
        reply_markup: new InlineKeyboard()
          .url("💳 Оплатить", invoice.pay_url).row()
          .text("✅ Я оплатил", `gift_check:${invoice.invoice_id}:${recipient}:${tariffId}`),
      });
    } catch (err) {
      console.error("[gift_pay_crypto] Ошибка:", err);
      await ctx.reply("❌ Не удалось создать счёт.");
    }
  });

  bot.callbackQuery(/^gift_check:(\d+):([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("🔍 Проверяем платёж...");
    const invoiceId = parseInt(ctx.match[1]);
    const recipient = ctx.match[2];
    const tariffId = ctx.match[3];

    try {
      const status = await cryptoBot.getInvoiceStatus(invoiceId);
      if (status !== "paid") {
        await ctx.reply("⏳ Платёж ещё не получен. Попробуйте позже.");
        return;
      }

      let recipientId: bigint;
      try {
        const chat = await bot.api.getChat(`@${recipient}`);
        recipientId = BigInt(chat.id);
      } catch {
        await ctx.reply("❌ Пользователь не найден. Убедитесь, что username правильный.");
        return;
      }

      await prisma.user.upsert({
        where: { id: recipientId },
        create: { id: recipientId, username: recipient },
        update: {},
      });
      await ctx.reply("🎁 Оплата прошла! Создаём ключ для получателя...");
      await grantVpnAccessById(ctx, recipientId, tariffId, 0, 0);
      await ctx.reply(`✅ Подарок для @${escapeMarkdown(recipient)} активирован\\!`);
    } catch (err) {
      console.error("[gift_check] Ошибка:", err);
      await ctx.reply("❌ Ошибка проверки платежа.");
    }
  });

  bot.callbackQuery(/^gift_pay_stars:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tariffId = ctx.match[1];
    const recipient = ctx.match[2];
    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const payload = `gift_stars:${recipient}:${tariffId}`;
    await ctx.replyWithInvoice(
      `🎁 Подарок для @${recipient}`,
      `Morena VPN — ${tariff.label}`,
      payload,
      "XTR",
      [{ label: tariff.label, amount: tariff.priceStars }]
    );
  });

  bot.callbackQuery(/^gift_pay_card:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tariffId   = ctx.match[1];
    const recipient  = ctx.match[2];
    const gifterId   = BigInt(ctx.from.id);

    if (!platega.isConfigured()) {
      await ctx.reply(
        `💳 *Оплата картой*\n\nОплата картой временно недоступна\\. Попробуйте CryptoBot или Telegram Stars\\.`,
        { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("◀️ Назад", "gift") }
      );
      return;
    }

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    await ctx.reply("⏳ Создаём счёт...");

    try {
      const payload = `gift_buy:${tariffId}:${recipient}:${gifterId}`;
      const invoice = await platega.createPayment(
        tariff.priceRub,
        `Morena VPN — Подарок (${tariff.label})`,
        payload,
        PLATEGA_METHOD.CARD,
        { userId: gifterId.toString(), userName: ctx.from.username ?? "user" }
      );

      await prisma.payment.create({
        data: {
          id:             invoice.transactionId,
          telegramUserId: gifterId,
          tariffId,
          amount:         tariff.priceRub,
          status:         "pending",
        },
      });

      const cbKeyGift = plategaCbSet({ transactionId: invoice.transactionId, tariffId, recipient });
      const keyboard = new InlineKeyboard()
        .url("💳 Оплатить картой", invoice.url).row()
        .text("✅ Я оплатил", `ckg:${cbKeyGift}`).row()
        .text("◀️ Назад", "gift");

      await ctx.reply(
        `🎁 *Подарок для @${escapeMarkdown(recipient)}*\n📦 *${escapeMarkdown(tariff.label)}*\n\n` +
        `💰 К оплате: *${escapeMarkdown(tariff.priceRub.toString())} ₽*\n` +
        `⏱ Счёт действует: ${escapeMarkdown(invoice.expiresIn)}`,
        { parse_mode: "MarkdownV2", reply_markup: keyboard }
      );
    } catch (err) {
      console.error("[gift_pay_card] Ошибка Platega:", err);
      await ctx.reply("❌ Не удалось создать счёт. Попробуйте другой способ оплаты.");
    }
  });

  bot.callbackQuery(/^gift_pay_sbp:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tariffId   = ctx.match[1];
    const recipient  = ctx.match[2];
    const gifterId   = BigInt(ctx.from.id);

    if (!platega.isConfigured()) {
      await ctx.reply(
        `📲 *СБП недоступен*\n\nПопробуйте CryptoBot или Telegram Stars\\.`,
        { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("◀️ Назад", "gift") }
      );
      return;
    }

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    await ctx.reply("⏳ Создаём счёт...");

    try {
      const payload = `gift_buy:${tariffId}:${recipient}:${gifterId}`;
      const invoice = await platega.createPayment(
        tariff.priceRub,
        `Morena VPN — Подарок (${tariff.label})`,
        payload,
        PLATEGA_METHOD.SBP,
        { userId: gifterId.toString(), userName: ctx.from.username ?? "user" }
      );

      await prisma.payment.create({
        data: {
          id:             invoice.transactionId,
          telegramUserId: gifterId,
          tariffId,
          amount:         tariff.priceRub,
          status:         "pending",
        },
      });

      const cbKeyGiftSbp = plategaCbSet({ transactionId: invoice.transactionId, tariffId, recipient });
      const keyboard = new InlineKeyboard()
        .url("📲 Оплатить через СБП", invoice.url).row()
        .text("✅ Я оплатил", `ckg:${cbKeyGiftSbp}`).row()
        .text("◀️ Назад", "gift");

      await ctx.reply(
        `🎁 *Подарок для @${escapeMarkdown(recipient)}*\n📦 *${escapeMarkdown(tariff.label)}*\n\n` +
        `💰 К оплате: *${escapeMarkdown(tariff.priceRub.toString())} ₽*\n` +
        `⏱ Счёт действует: ${escapeMarkdown(invoice.expiresIn)}`,
        { parse_mode: "MarkdownV2", reply_markup: keyboard }
      );
    } catch (err) {
      console.error("[gift_pay_sbp] Ошибка Platega:", err);
      await ctx.reply("❌ Не удалось создать счёт. Попробуйте другой способ оплаты.");
    }
  });

  bot.callbackQuery(/^pay_crypto:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tariffId = ctx.match[1];
    const userId = BigInt(ctx.from.id);

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const bonus = user?.balance ?? 0;
    const discount = Math.min(bonus, tariff.priceRub);
    const finalPrice = tariff.priceRub - discount;

    await ctx.reply("⏳ Создаём счёт на оплату...");

    try {
      if (finalPrice === 0) {
        await prisma.payment.create({
          data: {
            id: `bonus_${userId}_${Date.now()}`,
            telegramUserId: userId,
            tariffId,
            amount: 0,
            status: "paid",
          },
        });
        await grantVpnAccess(ctx, userId, tariffId, discount, 0);
        return;
      }

      const payload = `buy:${tariffId}:${userId}`;
      const invoice = await cryptoBot.createCryptoInvoice(finalPrice, payload);

      await prisma.payment.create({
        data: {
          id: invoice.invoice_id.toString(),
          telegramUserId: userId,
          tariffId,
          amount: finalPrice,
          status: "pending",
        },
      });

      const qrBuffer = await QRCode.toBuffer(invoice.pay_url, {
        type: "png",
        margin: 2,
        width: 512,
        color: { dark: "#1a1a2e", light: "#ffffff" },
      });

      const usdtAmount = (finalPrice / USDT_RUB_RATE).toFixed(2);
      const priceText = discount > 0
        ? `${tariff.priceRub} ₽ − ${discount} ₽ бонус = *${escapeMarkdown(usdtAmount)} USDT*`
        : `*${escapeMarkdown(usdtAmount)} USDT* ${escapeMarkdown(`(~${finalPrice} ₽)`)}`;

      const keyboard = new InlineKeyboard()
        .url("💳 Оплатить", invoice.pay_url).row()
        .text("✅ Я оплатил", `check_payment:${invoice.invoice_id}`);

      await ctx.replyWithPhoto(new InputFile(qrBuffer, "qr.png"), {
        caption:
          `🧾 *Счёт на оплату через CryptoBot*\n\n` +
          `📦 Тариф: *${escapeMarkdown(tariff.label)}*\n` +
          `💰 Сумма: ${priceText}\n\n` +
          `Оплатите USDT через CryptoBot\\.`,
        parse_mode: "MarkdownV2",
        reply_markup: keyboard,
      });

      startPaymentPolling(invoice.invoice_id, userId, tariffId, discount, ctx.chat!.id);
    } catch (err) {
      console.error("[pay_crypto] Ошибка создания инвойса:", err);
      await ctx.reply("❌ Не удалось создать счёт. Попробуйте позже.");
    }
  });

  bot.callbackQuery(/^pay_stars:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tariffId = ctx.match[1];
    const userId = BigInt(ctx.from.id);

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const bonus = user?.balance ?? 0;
    const discount = Math.min(bonus, tariff.priceRub);
    const starsPrice = Math.max(0, tariff.priceStars - Math.round(discount / 2.38));

    try {
      const payload = `stars:${tariffId}:${userId}`;
      await ctx.replyWithInvoice(tariff.label, `Morena VPN — ${tariff.label}`, payload, "XTR", [{ label: tariff.label, amount: starsPrice }]);
    } catch (err) {
      console.error("[pay_stars] Ошибка:", err);
      await ctx.reply("❌ Не удалось создать счёт. Попробуйте позже.");
    }
  });

  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("message:successful_payment", async (ctx) => {
    const msg = ctx.message;
    if (!msg.successful_payment) return;
    const userId = BigInt(ctx.from.id);
    const payload = (msg.successful_payment as any).payload || (msg.successful_payment as any).invoice_payload;
    const starsAmount = msg.successful_payment.total_amount;

    const parts = payload.split(":");
    const type = parts[0];

    if (type === "stars") {
      if (parts.length < 3) return;
      const tariffId = parts[1];

      const tariff = TARIFFS.find((t) => t.id === tariffId);
      if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      const bonus = user?.balance ?? 0;
      const discount = Math.min(bonus, tariff.priceRub);

      await prisma.payment.create({
        data: {
          id: `stars_${userId}_${Date.now()}`,
          telegramUserId: userId,
          tariffId,
          amount: Math.round(starsAmount * 2.38),
          status: "paid",
        },
      });

      await grantVpnAccess(ctx, userId, tariffId, discount, Math.round(starsAmount * 2.38));
    } else if (type === "gift_stars") {
      if (parts.length < 3) return;
      const recipient = parts[1];
      const tariffId = parts[2];

      const tariff = TARIFFS.find((t) => t.id === tariffId);
      if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

      let recipientId: bigint;
      try {
        const chat = await bot.api.getChat(`@${recipient}`);
        recipientId = BigInt(chat.id);
      } catch {
        await ctx.reply("❌ Пользователь не найден.");
        return;
      }

      await prisma.user.upsert({
        where: { id: recipientId },
        create: { id: recipientId, username: recipient },
        update: {},
      });

      await grantVpnAccess(ctx, recipientId, tariffId, 0, Math.round(starsAmount * 2.38));
      await ctx.reply(`✅ Подарок для @${escapeMarkdown(recipient)} активирован\\!`);
    } else if (type === "renew_stars") {
      if (parts.length < 3) return;
      const subId = parts[1];
      const tariffId = parts[2];

      const tariff = TARIFFS.find((t) => t.id === tariffId);
      if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      const bonus = user?.balance ?? 0;
      const discount = Math.min(bonus, tariff.priceRub);

      await prisma.payment.create({
        data: {
          id: `stars_renew_${userId}_${Date.now()}`,
          telegramUserId: userId,
          tariffId,
          amount: Math.round(starsAmount * 2.38),
          status: "paid",
        },
      });

      await processRenewal(ctx, userId, subId, tariffId, discount);
    }
  });

  bot.callbackQuery(/^pay_card:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tariffId = ctx.match[1];
    const userId   = BigInt(ctx.from.id);

    if (!platega.isConfigured()) {
      await ctx.reply(
        `💳 *Оплата картой*\n\nОплата картой временно недоступна\\. Попробуйте CryptoBot или Telegram Stars\\.`,
        { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("◀️ Назад", `buy_tariff:${tariffId}`) }
      );
      return;
    }

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const user     = await prisma.user.findUnique({ where: { id: userId } });
    const bonus    = user?.balance ?? 0;
    const discount = Math.min(bonus, tariff.priceRub);
    const final    = tariff.priceRub - discount;

    await ctx.reply("⏳ Создаём счёт на оплату...");

    try {
      if (final === 0) {
        await prisma.payment.create({
          data: { id: `bonus_${userId}_${Date.now()}`, telegramUserId: userId, tariffId, amount: 0, status: "paid" },
        });
        await grantVpnAccess(ctx, userId, tariffId, discount, 0);
        return;
      }

      const payload = `buy:${tariffId}:${userId}`;
      const invoice = await platega.createPayment(
        final,
        `Morena VPN — ${tariff.label}`,
        payload,
        PLATEGA_METHOD.CARD,
        { userId: userId.toString(), userName: ctx.from.username ?? "user" }
      );

      await prisma.payment.create({
        data: { id: invoice.transactionId, telegramUserId: userId, tariffId, amount: final, status: "pending" },
      });

      const priceText = discount > 0
        ? `${tariff.priceRub} ₽ − ${discount} ₽ бонус = *${escapeMarkdown(final.toString())} ₽*`
        : `*${escapeMarkdown(final.toString())} ₽*`;

      const cbKeyBuy = plategaCbSet({ transactionId: invoice.transactionId, tariffId });
      const keyboard = new InlineKeyboard()
        .url("💳 Оплатить картой", invoice.url).row()
        .text("✅ Я оплатил", `ckb:${cbKeyBuy}`).row()
        .text("◀️ Назад", `buy_tariff:${tariffId}`);

      await ctx.reply(
        `💳 *Оплата картой — Morena VPN*\n\n📦 *${escapeMarkdown(tariff.label)}*\n` +
        `💰 К оплате: ${priceText}\n⏱ Счёт действует: ${escapeMarkdown(invoice.expiresIn)}\n\n` +
        `Нажмите кнопку ниже для оплаты:`,
        { parse_mode: "MarkdownV2", reply_markup: keyboard }
      );

      startPlategalBuyPolling(invoice.transactionId, userId, tariffId, discount, ctx.chat!.id);
    } catch (err) {
      console.error("[pay_card] Ошибка Platega:", err);
      await ctx.reply("❌ Не удалось создать счёт. Попробуйте позже или выберите другой способ оплаты.");
    }
  });

  bot.callbackQuery(/^pay_sbp:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tariffId = ctx.match[1];
    const userId   = BigInt(ctx.from.id);

    if (!platega.isConfigured()) {
      await ctx.reply(
        `📲 *Оплата через СБП*\n\nСБП временно недоступен\\. Попробуйте CryptoBot или Telegram Stars\\.`,
        { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("◀️ Назад", `buy_tariff:${tariffId}`) }
      );
      return;
    }

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const user     = await prisma.user.findUnique({ where: { id: userId } });
    const bonus    = user?.balance ?? 0;
    const discount = Math.min(bonus, tariff.priceRub);
    const final    = tariff.priceRub - discount;

    await ctx.reply("⏳ Создаём счёт на оплату...");

    try {
      if (final === 0) {
        await prisma.payment.create({
          data: { id: `bonus_${userId}_${Date.now()}`, telegramUserId: userId, tariffId, amount: 0, status: "paid" },
        });
        await grantVpnAccess(ctx, userId, tariffId, discount, 0);
        return;
      }

      const payload = `buy:${tariffId}:${userId}`;
      const invoice = await platega.createPayment(
        final,
        `Morena VPN — ${tariff.label}`,
        payload,
        PLATEGA_METHOD.SBP,
        { userId: userId.toString(), userName: ctx.from.username ?? "user" }
      );

      await prisma.payment.create({
        data: { id: invoice.transactionId, telegramUserId: userId, tariffId, amount: final, status: "pending" },
      });

      const priceText = discount > 0
        ? `${tariff.priceRub} ₽ − ${discount} ₽ бонус = *${escapeMarkdown(final.toString())} ₽*`
        : `*${escapeMarkdown(final.toString())} ₽*`;

      const cbKeyBuy = plategaCbSet({ transactionId: invoice.transactionId, tariffId });
      const keyboard = new InlineKeyboard()
        .url("📲 Оплатить через СБП", invoice.url).row()
        .text("✅ Я оплатил", `ckb:${cbKeyBuy}`).row()
        .text("◀️ Назад", `buy_tariff:${tariffId}`);

      await ctx.reply(
        `📲 *Оплата через СБП — Morena VPN*\n\n📦 *${escapeMarkdown(tariff.label)}*\n` +
        `💰 К оплате: ${priceText}\n⏱ Счёт действует: ${escapeMarkdown(invoice.expiresIn)}\n\n` +
        `Нажмите кнопку ниже для оплаты:`,
        { parse_mode: "MarkdownV2", reply_markup: keyboard }
      );

      startPlategalBuyPolling(invoice.transactionId, userId, tariffId, discount, ctx.chat!.id);
    } catch (err) {
      console.error("[pay_sbp] Ошибка Platega:", err);
      await ctx.reply("❌ Не удалось создать счёт. Попробуйте позже или выберите другой способ оплаты.");
    }
  });

  // ─── Platega payment helpers ────────────────────────────────────────────────

  async function markPlategalInvoicePaid(
    transactionId: string,
    processor: () => Promise<void>
  ): Promise<boolean> {
    try {
      // Single atomic UPDATE — only succeeds if still pending; prevents double-provisioning
      // from concurrent poll + manual-check handlers both seeing the pending state.
      const result = await prisma.payment.updateMany({
        where: { id: transactionId, status: "pending" },
        data:  { status: "paid" },
      });
      if (result.count > 0) {
        await processor();
        return true;
      }
      console.log(`[markPlategalInvoicePaid] Транзакция ${transactionId} уже обработана — skipping`);
      return false;
    } catch (err) {
      console.error(`[markPlategalInvoicePaid] Ошибка для ${transactionId}:`, err);
      return false;
    }
  }

  async function markPlategalInvoiceFailed(transactionId: string): Promise<boolean> {
    try {
      const result = await prisma.payment.updateMany({
        where: { id: transactionId, status: "pending" },
        data:  { status: "failed" },
      });
      return result.count > 0;
    } catch (err) {
      console.error(`[markPlategalInvoiceFailed] Ошибка для ${transactionId}:`, err);
      return false;
    }
  }

  function startPlategalBuyPolling(
    transactionId: string,
    userId: bigint,
    tariffId: string,
    bonusUsed: number,
    chatId: number | string
  ): void {
    const MAX_ATTEMPTS = Math.floor(POLL_MAX_MS / POLL_INTERVAL_MS);
    let attempts = 0;

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(interval);
        console.log(`[platega_poll] Транзакция ${transactionId} истекла по таймауту`);
        return;
      }
      try {
        const result = await platega.checkStatus(transactionId);
        if (result.status === "CONFIRMED") {
          clearInterval(interval);
          await markPlategalInvoicePaid(transactionId, async () => {
            await grantVpnAccessById(chatId, userId, tariffId, bonusUsed);
          });
        } else if (result.status === "CANCELED" || result.status === "CHARGEBACKED") {
          clearInterval(interval);
          await markPlategalInvoiceFailed(transactionId);
          await bot.api.sendMessage(chatId, `❌ Платёж отменён\\. Попробуйте снова\\.`, { parse_mode: "MarkdownV2" });
        }
      } catch (err) {
        console.error(`[platega_poll] Ошибка проверки ${transactionId}:`, err);
      }
    }, POLL_INTERVAL_MS);
  }

  function startPlategalRenewalPolling(
    transactionId: string,
    userId: bigint,
    subId: string,
    tariffId: string,
    bonusUsed: number,
    chatId: number | string
  ): void {
    const MAX_ATTEMPTS = Math.floor(POLL_MAX_MS / POLL_INTERVAL_MS);
    let attempts = 0;

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) { clearInterval(interval); return; }
      try {
        const result = await platega.checkStatus(transactionId);
        if (result.status === "CONFIRMED") {
          clearInterval(interval);
          await markPlategalInvoicePaid(transactionId, async () => {
            await processRenewal(chatId, userId, subId, tariffId, bonusUsed);
          });
        } else if (result.status === "CANCELED" || result.status === "CHARGEBACKED") {
          clearInterval(interval);
          await markPlategalInvoiceFailed(transactionId);
        }
      } catch (err) {
        console.error(`[platega_renew_poll] Ошибка проверки ${transactionId}:`, err);
      }
    }, POLL_INTERVAL_MS);
  }

  // ─── Platega check callbacks ─────────────────────────────────────────────

  bot.callbackQuery(/^ckb:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const cbData = plategaCb.get(ctx.match[1]);
    if (!cbData) { await ctx.reply("⏳ Счёт устарел, попробуйте создать новый."); return; }
    const transactionId = cbData.transactionId;
    const tariffId      = cbData.tariffId;
    const userId        = BigInt(ctx.from.id);

    try {
      const payment = await prisma.payment.findUnique({ where: { id: transactionId } });
      if (!payment) { await ctx.reply("❌ Платёж не найден."); return; }
      if (payment.telegramUserId !== userId) { await ctx.reply("❌ Этот счёт не принадлежит вам."); return; }
      if (payment.status === "paid") {
        // Проверяем, создана ли подписка (если grantVpnAccess упал с ошибкой ранее)
        const existingSub = await prisma.subscription.findFirst({ where: { telegramUserId: userId, tariffId } });
        if (!existingSub) {
          await ctx.reply("🔄 Платёж обработан, создаю ключ...");
          const tariffForBonus = TARIFFS.find((t) => t.id === tariffId);
          const bonusUsed = tariffForBonus ? Math.max(0, tariffForBonus.priceRub - payment.amount) : 0;
          await grantVpnAccess(ctx, userId, tariffId, bonusUsed, payment.amount);
          return;
        }
        await ctx.reply("✅ Платёж уже обработан.");
        return;
      }

      // Derive bonusUsed from stored payment amount vs tariff price (avoids storing extra field)
      const tariffForBonus = TARIFFS.find((t) => t.id === tariffId);
      const bonusUsed = tariffForBonus ? Math.max(0, tariffForBonus.priceRub - payment.amount) : 0;

      const result = await platega.checkStatus(transactionId);
      if (result.status === "CONFIRMED") {
        await markPlategalInvoicePaid(transactionId, async () => {
          await grantVpnAccess(ctx, userId, tariffId, bonusUsed, payment.amount);
        });
      } else if (result.status === "CANCELED" || result.status === "CHARGEBACKED") {
        await markPlategalInvoiceFailed(transactionId);
        await ctx.reply("❌ Платёж отменён. Попробуйте снова.");
      } else {
        await ctx.reply("⏳ Платёж ещё не поступил. Попробуйте чуть позже.");
      }
    } catch (err) {
      console.error("[check_platega_buy] Ошибка:", err);
      await ctx.reply("❌ Ошибка при проверке платежа. Попробуйте позже.");
    }
  });

  bot.callbackQuery(/^ckg:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("🔍 Проверяем платёж...");
    const cbData = plategaCb.get(ctx.match[1]);
    if (!cbData) { await ctx.reply("⏳ Счёт устарел, попробуйте создать новый."); return; }
    const transactionId = cbData.transactionId;
    const tariffId      = cbData.tariffId;
    const recipient     = cbData.recipient;
    const userId        = BigInt(ctx.from.id);

    try {
      const payment = await prisma.payment.findUnique({ where: { id: transactionId } });
      if (!payment) { await ctx.reply("❌ Платёж не найден."); return; }
      if (payment.telegramUserId !== userId) { await ctx.reply("❌ Этот счёт не принадлежит вам."); return; }
      if (payment.status === "paid") { await ctx.reply("✅ Платёж уже обработан."); return; }

      const result = await platega.checkStatus(transactionId);
      if (result.status === "CONFIRMED") {
        await markPlategalInvoicePaid(transactionId, async () => {
          // The webhook will handle VPN provisioning; here we just confirm to the user
          await ctx.reply(`✅ Платёж подтверждён\\! Подарок для *@${escapeMarkdown(recipient)}* будет активирован в ближайшие секунды\\.`, { parse_mode: "MarkdownV2" });
        });
      } else if (result.status === "CANCELED" || result.status === "CHARGEBACKED") {
        await markPlategalInvoiceFailed(transactionId);
        await ctx.reply("❌ Платёж отменён. Попробуйте снова.");
      } else {
        await ctx.reply("⏳ Платёж ещё не поступил. Попробуйте чуть позже.");
      }
    } catch (err) {
      console.error("[check_platega_gift] Ошибка:", err);
      await ctx.reply("❌ Ошибка при проверке платежа. Попробуйте позже.");
    }
  });

  // ────────────────────────────────────────────────────────────────────────────

  async function markInvoicePaid(
    invoiceId: number,
    processor: () => Promise<void>
  ): Promise<boolean> {
    try {
      const wasUpdated = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: invoiceId.toString() },
        });
        if (!payment || payment.status === "paid") {
          return false;
        }
        await tx.payment.update({
          where: { id: invoiceId.toString() },
          data: { status: "paid" },
        });
        return true;
      });

      if (wasUpdated) {
        await processor();
      } else {
        console.log(`[markInvoicePaid] Инвойс ${invoiceId} уже обработан, пропускаем`);
      }
      return wasUpdated;
    } catch (err) {
      console.error(`[markInvoicePaid] Ошибка для инвойса ${invoiceId}:`, err);
      return false;
    }
  }

  async function markInvoiceFailed(invoiceId: number): Promise<boolean> {
    try {
      const wasUpdated = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: invoiceId.toString() },
        });
        if (!payment || payment.status !== "pending") {
          return false;
        }
        await tx.payment.update({
          where: { id: invoiceId.toString() },
          data: { status: "failed" },
        });
        return true;
      });
      return wasUpdated;
    } catch (err) {
      console.error(`[markInvoiceFailed] Ошибка для инвойса ${invoiceId}:`, err);
      return false;
    }
  }

  function startPaymentPolling(
    invoiceId: number,
    userId: bigint,
    tariffId: string,
    bonusUsed: number,
    chatId: number | string
  ): void {
    const MAX_ATTEMPTS = Math.floor(POLL_MAX_MS / POLL_INTERVAL_MS);
    let attempts = 0;

    const interval = setInterval(async () => {
      attempts++;

      if (attempts > MAX_ATTEMPTS) {
        clearInterval(interval);
        console.log(`[poll] Инвойс ${invoiceId} истёк по таймауту`);
        return;
      }

      try {
        const status = await cryptoBot.getInvoiceStatus(invoiceId);

        if (status === "paid") {
          clearInterval(interval);
          console.log(`[poll] Инвойс ${invoiceId} оплачен! Выдаём ключ пользователю ${userId}`);
          await markInvoicePaid(invoiceId, async () => {
            await grantVpnAccessById(chatId, userId, tariffId, bonusUsed);
          });
        } else if (status === "expired" || status === "cancelled") {
          clearInterval(interval);
          await markInvoiceFailed(invoiceId);

          await bot.api.sendMessage(
            chatId,
            `❌ Счёт №${invoiceId} был отменён или истёк\\. Попробуйте снова\\.`,
            { parse_mode: "MarkdownV2" }
          );
        }
      } catch (err) {
        console.error(`[poll] Ошибка проверки инвойса ${invoiceId}:`, err);
      }
    }, POLL_INTERVAL_MS);
  }

  bot.callbackQuery(/^check_payment:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("🔍 Проверяем платёж...");
    const invoiceId = parseInt(ctx.match[1]);
    const userId = BigInt(ctx.from.id);

    try {
      const status = await cryptoBot.getInvoiceStatus(invoiceId);

      if (status === "paid") {
        const payment = await prisma.payment.findUnique({ where: { id: invoiceId.toString() } });
        if (!payment) {
          await ctx.reply("❌ Платёж не найден.");
          return;
        }

        // Verify ownership — only the payer can claim this invoice
        if (payment.telegramUserId !== userId) {
          await ctx.reply("❌ Этот счёт не принадлежит вам.");
          return;
        }

        await markInvoicePaid(invoiceId, async () => {
          await grantVpnAccess(ctx, userId, payment.tariffId, 0, payment.amount);
        });
      } else if (status === "active") {
        await ctx.reply(
          `⏳ Платёж ещё не получен\\. Ожидаем подтверждения\\.\n\nПопробуйте нажать кнопку ещё раз через 30 секунд\\.`,
          { parse_mode: "MarkdownV2" }
        );
      } else {
        await ctx.reply("❌ Счёт был отменён или истёк. Создайте новый заказ.");
      }
    } catch (err) {
      console.error("[check_payment] Ошибка:", err);
      await ctx.reply("❌ Ошибка проверки платежа. Попробуйте позже.");
    }
  });

  async function grantVpnAccess(
    ctx: { reply: Function },
    userId: bigint,
    tariffId: string,
    bonusUsed: number,
    amountPaid: number
  ): Promise<void> {
    await grantVpnAccessById(ctx, userId, tariffId, bonusUsed, amountPaid);
  }

  async function grantVpnAccessById(
    target: { reply: Function } | number | string,
    userId: bigint,
    tariffId: string,
    bonusUsed: number,
    amountPaid?: number
  ): Promise<void> {
    try {
      const tariffObj = TARIFFS.find((t) => t.id === tariffId);
      if (!tariffObj) {
        throw new Error(`Тариф ${tariffId} не найден`);
      }

      // Step 1: Create VPN user
      const vpnUser = await royaltyKey.createUser();

      // Step 2: Add subscription with correct tariff and days
      const subResult = await royaltyKey.addSubscription(
        vpnUser.uuid,
        tariffObj.apiDays,
        tariffObj.apiTariff
      );

      const expiresAt = new Date(Date.now() + tariffObj.durationDays * 86400000);
      await prisma.subscription.create({
        data: {
          id: vpnUser.uuid,
          telegramUserId: userId,
          vpnKey: vpnUser.subscription_url,
          tariffId,
          expiresAt,
        },
      });

      if (bonusUsed > 0) {
        await prisma.user.update({
          where: { id: userId },
          data: { balance: { decrement: bonusUsed } },
        });
      }

      const expText = escapeMarkdown(formatDate(expiresAt));
      const successText =
        `🎉 *Оплата прошла успешно\\!*\n\n` +
        `${formatVpnKey(vpnUser.subscription_url)}\n\n` +
        `📅 Действует до: *${expText}*`;

      const purchaseSiteUrl = `https://autoconnect-chi.vercel.app/?key=${encodeURIComponent(vpnUser.subscription_url)}`;
      const keyboard = new InlineKeyboard()
        .url("🚀 Автоподключение", purchaseSiteUrl)
        .row()
        .text("ℹ️ Инструкция по настройке", "howto");

      if (typeof target === "object" && "reply" in target) {
        await (target as { reply: Function }).reply(successText, {
          parse_mode: "MarkdownV2",
          reply_markup: keyboard,
        });
      } else {
        await bot.api.sendMessage(target as number, successText, {
          parse_mode: "MarkdownV2",
          reply_markup: keyboard,
        });
      }
    } catch (err) {
      console.error("[grantVpnAccess] Ошибка выдачи ключа:", err);
      const errMsg = "❌ Оплата прошла, но ключ не удалось создать. Обратитесь в поддержку.";

      if (typeof target === "object" && "reply" in target) {
        await (target as { reply: Function }).reply(errMsg);
      } else {
        await bot.api.sendMessage(target as number, errMsg);
      }

      const errStr = String(err);
      if (errStr.includes("402") || errStr.includes("Payment Required")) {
        const adminId = process.env.ADMIN_TELEGRAM_ID;
        if (adminId) {
          await bot.api.sendMessage(
            adminId,
            `⚠️ *RoyaltyKey баланс закончился*\n\nПополните баланс, чтобы пользователи могли получать ключи VPN\\.\n\nОшибка: \`${escapeMarkdown(errStr)}\``,
            { parse_mode: "MarkdownV2" }
          ).catch((e) => console.error("[grantVpnAccess] Ошибка уведомления админа:", e));
        }
      }
    }
  }

  bot.callbackQuery("profile", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = BigInt(ctx.from.id);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const subs = await prisma.subscription.findMany({
      where: { telegramUserId: userId },
      orderBy: { expiresAt: "desc" },
    });

    const botUsername = (await bot.api.getMe()).username;
    const refLink = escapeMarkdown(`https://t.me/${botUsername}?start=ref_${userId}`);

    let profileText =
      `👤 *Личный чертог*\n\n` +
      `🔔 Ваш ID: \`${userId}\`\n` +
      `💰 Бонусный баланс: *${escapeMarkdown((user?.balance ?? 0).toString())} ₽*\n` +
      `🔗 Реферальная ссылка:\n\`${refLink}\`\n\n`;

    const keyboard = new InlineKeyboard();

    if (subs.length === 0) {
      profileText += `📭 У вас нет активных подписок\\.`;
    } else {
      profileText += `📋 *Ваши подписки:*\n\n`;
      subs.forEach((sub, i) => {
        const status = subStatus(sub);
        const expiry = escapeMarkdown(formatDate(new Date(sub.expiresAt)));
        const isObhod = sub.tariffId.startsWith("obhod_");
        profileText +=
          `${i + 1}\\. ${status}` +
          (isObhod ? " 🌌" : "") +
          `\n   📅 До: ${expiry}\n\n`;
        keyboard.text(`🔄 Продлить #${i + 1}`, `renew_sub:${sub.id}`).row();
        if (isObhod && subStatus(sub) === "🟢 Активна") {
          keyboard.text(`📡 Трафик #${i + 1}`, `buy_traffic:${sub.id}`).row();
        }
      });
    }

    keyboard.text("◀️ В меню", "menu");

    await ctx.reply(profileText, {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
  });

  async function showRenewalOptions(
    ctx: { reply: Function; from?: { id: number } },
    subId: string
  ): Promise<void> {
    if (!ctx.from) {
      await ctx.reply("⚠️ Не удалось определить пользователя.");
      return;
    }
    const userId = BigInt(ctx.from.id);

    const sub = await prisma.subscription.findUnique({ where: { id: subId } });
    if (!sub || sub.telegramUserId !== userId) {
      await ctx.reply("❌ Подписка не найдена.");
      return;
    }

    const text =
      `🔄 *Продление подписки*\n\n` +
      `🌟 *Тариф — Классик*\n` +
      `Скоростные сервера 10 Гбит, без ограничений и лимитов\\.\n\n` +
      `🌌 *Тариф — Цифровой камуфляж*\n` +
      `Специализированные серверы с технологией цифрового камуфляжа, гарантирующие стабильный доступ к важным ресурсам в любом регионе\\.\n\n` +
      `Выберите желаемый тариф:`;

    const keyboard = new InlineKeyboard()
      .text("🌟 Классик", `renew_type:${subId}:classic`).row()
      .text("🌌 Цифровой камуфляж", `renew_type:${subId}:obhod`).row()
      .text("◀️ Назад", "profile");

    await ctx.reply(text, {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
  }

  bot.callbackQuery(/^renew_sub:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showRenewalOptions(ctx, ctx.match[1]);
  });

  bot.callbackQuery(/^renew_type:([^:]+):(classic|obhod)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId = ctx.match[1];
    const type = ctx.match[2];
    const userId = BigInt(ctx.from.id);

    const sub = await prisma.subscription.findUnique({ where: { id: subId } });
    if (!sub || sub.telegramUserId !== userId) {
      await ctx.reply("❌ Подписка не найдена.");
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const bonus = user?.balance ?? 0;

    const tariffs = type === "classic" ? CLASSIC_TARIFFS : OBHOD_TARIFFS;
    const label = type === "classic" ? "🌟 Классик" : "🌌 Цифровой камуфляж";

    const keyboard = new InlineKeyboard();
    for (const tariff of tariffs) {
      const finalPrice = Math.max(0, tariff.priceRub - bonus);
      const usdtPrice = (finalPrice / USDT_RUB_RATE).toFixed(2);
      const priceText =
        bonus > 0
          ? `${tariff.label} — ${usdtPrice} USDT (скидка ${Math.min(bonus, tariff.priceRub)} ₽)`
          : `${tariff.label}`;
      keyboard.text(priceText, `renew_pay:${subId}:${tariff.id}`).row();
    }
    keyboard.text("◀️ Назад", `renew_sub:${subId}`);

    const bonusText =
      bonus > 0
        ? escapeMarkdown(`\n\n💰 У вас ${bonus} ₽ бонуса — скидка применена автоматически.`)
        : "";

    await ctx.reply(`*${label}*\n\n⚡ Выберите тариф:${bonusText}`, {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^renew_pay:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId = ctx.match[1];
    const tariffId = ctx.match[2];

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const keyboard = new InlineKeyboard()
      .text("⚡ CryptoBot (USDT)", `renew_crypto:${subId}:${tariffId}`).row()
      .text("⭐ Telegram Stars", `renew_stars:${subId}:${tariffId}`).row()
      .text("💳 Картой (РФ)", `renew_card:${subId}:${tariffId}`).row()
      .text("📲 СБП", `renew_sbp:${subId}:${tariffId}`).row()
      .text("◀️ Назад", `renew_sub:${subId}`);

    await ctx.reply(
      `🔄 *Продление подписки*\n📦 *${escapeMarkdown(tariff.label)}*\n\nВыберите способ оплаты:`,
      { parse_mode: "MarkdownV2", reply_markup: keyboard }
    );
  });

  bot.callbackQuery(/^renew_crypto:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId = ctx.match[1];
    const tariffId = ctx.match[2];
    const userId = BigInt(ctx.from.id);

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const bonus = user?.balance ?? 0;
    const discount = Math.min(bonus, tariff.priceRub);
    const finalPrice = tariff.priceRub - discount;

    await ctx.reply("⏳ Создаём счёт...");

    try {
      if (finalPrice === 0) {
        await prisma.payment.create({
          data: {
            id: `bonus_renew_${userId}_${Date.now()}`,
            telegramUserId: userId,
            tariffId,
            amount: 0,
            status: "paid",
          },
        });
        await processRenewal(ctx, userId, subId, tariffId, discount);
        return;
      }

      const usdtAmount = (finalPrice / USDT_RUB_RATE).toFixed(2);
      const payload = `renew:${subId}:${tariffId}`;
      const invoice = await cryptoBot.createCryptoInvoice(finalPrice, payload);

      await prisma.payment.create({
        data: {
          id: invoice.invoice_id.toString(),
          telegramUserId: userId,
          tariffId,
          amount: finalPrice,
          status: "pending",
        },
      });

      const qrBuffer = await QRCode.toBuffer(invoice.pay_url, {
        type: "png",
        margin: 2,
        width: 512,
      });

      const keyboard = new InlineKeyboard()
        .url("💳 Оплатить", invoice.pay_url).row()
        .text("✅ Я оплатил", `check_renew:${invoice.invoice_id}:${subId}:${tariffId}`);

      await ctx.replyWithPhoto(new InputFile(qrBuffer, "qr.png"), {
        caption:
          `🧾 *Продление подписки*\n\n` +
          `📦 Тариф: *${escapeMarkdown(tariff.label)}*\n` +
          `💰 Сумма: *${escapeMarkdown(usdtAmount)} USDT* ${escapeMarkdown(`(~${finalPrice} ₽)`)}`,

        parse_mode: "MarkdownV2",
        reply_markup: keyboard,
      });

      startRenewalPolling(invoice.invoice_id, userId, subId, tariffId, discount, ctx.chat!.id);
    } catch (err) {
      console.error("[renew_crypto] Ошибка:", err);
      await ctx.reply("❌ Не удалось создать счёт. Попробуйте позже.");
    }
  });

  bot.callbackQuery(/^renew_stars:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId = ctx.match[1];
    const tariffId = ctx.match[2];
    const userId = BigInt(ctx.from.id);

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const bonus = user?.balance ?? 0;
    const discount = Math.min(bonus, tariff.priceRub);
    const starsPrice = Math.max(0, tariff.priceStars - Math.round(discount / 2.38));

    try {
      const payload = `renew_stars:${subId}:${tariffId}`;
      await ctx.replyWithInvoice(`🔄 Продление ${tariff.label}`, `Morena VPN — продление`, payload, "XTR", [{ label: tariff.label, amount: starsPrice }]);
    } catch (err) {
      console.error("[renew_stars] Ошибка:", err);
      await ctx.reply("❌ Не удалось создать счёт. Попробуйте позже.");
    }
  });

  bot.callbackQuery(/^renew_card:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId    = ctx.match[1];
    const tariffId = ctx.match[2];
    const userId   = BigInt(ctx.from.id);

    if (!platega.isConfigured()) {
      await ctx.reply(
        `💳 *Оплата картой*\n\nОплата картой временно недоступна\\. Попробуйте CryptoBot или Telegram Stars\\.`,
        { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("◀️ Назад", `renew_pay:${subId}:${tariffId}`) }
      );
      return;
    }

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const user     = await prisma.user.findUnique({ where: { id: userId } });
    const bonus    = user?.balance ?? 0;
    const discount = Math.min(bonus, tariff.priceRub);
    const final    = tariff.priceRub - discount;

    await ctx.reply("⏳ Создаём счёт на оплату...");

    try {
      if (final === 0) {
        await prisma.payment.create({
          data: { id: `bonus_renew_${userId}_${Date.now()}`, telegramUserId: userId, tariffId, amount: 0, status: "paid" },
        });
        await processRenewal(ctx, userId, subId, tariffId, discount);
        return;
      }

      const payload = `renew:${subId}:${tariffId}:${userId}`;
      const invoice = await platega.createPayment(
        final,
        `Morena VPN — Продление (${tariff.label})`,
        payload,
        PLATEGA_METHOD.CARD,
        { userId: userId.toString(), userName: ctx.from.username ?? "user" }
      );

      await prisma.payment.create({
        data: { id: invoice.transactionId, telegramUserId: userId, tariffId, amount: final, status: "pending" },
      });

      const priceText = discount > 0
        ? `${tariff.priceRub} ₽ − ${discount} ₽ бонус = *${escapeMarkdown(final.toString())} ₽*`
        : `*${escapeMarkdown(final.toString())} ₽*`;

      const cbKeyRenew = plategaCbSet({ transactionId: invoice.transactionId, subId, tariffId });
      const keyboard = new InlineKeyboard()
        .url("💳 Оплатить картой", invoice.url).row()
        .text("✅ Я оплатил", `ckr:${cbKeyRenew}`).row()
        .text("◀️ Назад", `renew_pay:${subId}:${tariffId}`);

      await ctx.reply(
        `💳 *Продление картой — Morena VPN*\n\n📦 *${escapeMarkdown(tariff.label)}*\n` +
        `💰 К оплате: ${priceText}\n⏱ Счёт действует: ${escapeMarkdown(invoice.expiresIn)}`,
        { parse_mode: "MarkdownV2", reply_markup: keyboard }
      );

      startPlategalRenewalPolling(invoice.transactionId, userId, subId, tariffId, discount, ctx.chat!.id);
    } catch (err) {
      console.error("[renew_card] Ошибка Platega:", err);
      await ctx.reply("❌ Не удалось создать счёт. Попробуйте позже или выберите другой способ оплаты.");
    }
  });

  bot.callbackQuery(/^renew_sbp:([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId    = ctx.match[1];
    const tariffId = ctx.match[2];
    const userId   = BigInt(ctx.from.id);

    if (!platega.isConfigured()) {
      await ctx.reply(
        `📲 *Оплата через СБП*\n\nСБП временно недоступен\\. Попробуйте CryptoBot или Telegram Stars\\.`,
        { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("◀️ Назад", `renew_pay:${subId}:${tariffId}`) }
      );
      return;
    }

    const tariff = TARIFFS.find((t) => t.id === tariffId);
    if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

    const user     = await prisma.user.findUnique({ where: { id: userId } });
    const bonus    = user?.balance ?? 0;
    const discount = Math.min(bonus, tariff.priceRub);
    const final    = tariff.priceRub - discount;

    await ctx.reply("⏳ Создаём счёт на оплату...");

    try {
      if (final === 0) {
        await prisma.payment.create({
          data: { id: `bonus_renew_${userId}_${Date.now()}`, telegramUserId: userId, tariffId, amount: 0, status: "paid" },
        });
        await processRenewal(ctx, userId, subId, tariffId, discount);
        return;
      }

      const payload = `renew:${subId}:${tariffId}:${userId}`;
      const invoice = await platega.createPayment(
        final,
        `Morena VPN — Продление (${tariff.label})`,
        payload,
        PLATEGA_METHOD.SBP,
        { userId: userId.toString(), userName: ctx.from.username ?? "user" }
      );

      await prisma.payment.create({
        data: { id: invoice.transactionId, telegramUserId: userId, tariffId, amount: final, status: "pending" },
      });

      const priceText = discount > 0
        ? `${tariff.priceRub} ₽ − ${discount} ₽ бонус = *${escapeMarkdown(final.toString())} ₽*`
        : `*${escapeMarkdown(final.toString())} ₽*`;

      const cbKeyRenew = plategaCbSet({ transactionId: invoice.transactionId, subId, tariffId });
      const keyboard = new InlineKeyboard()
        .url("📲 Оплатить через СБП", invoice.url).row()
        .text("✅ Я оплатил", `ckr:${cbKeyRenew}`).row()
        .text("◀️ Назад", `renew_pay:${subId}:${tariffId}`);

      await ctx.reply(
        `📲 *Продление через СБП — Morena VPN*\n\n📦 *${escapeMarkdown(tariff.label)}*\n` +
        `💰 К оплате: ${priceText}\n⏱ Счёт действует: ${escapeMarkdown(invoice.expiresIn)}`,
        { parse_mode: "MarkdownV2", reply_markup: keyboard }
      );

      startPlategalRenewalPolling(invoice.transactionId, userId, subId, tariffId, discount, ctx.chat!.id);
    } catch (err) {
      console.error("[renew_sbp] Ошибка Platega:", err);
      await ctx.reply("❌ Не удалось создать счёт. Попробуйте позже или выберите другой способ оплаты.");
    }
  });

  bot.callbackQuery(/^ckr:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("🔍 Проверяем платёж...");
    const cbData = plategaCb.get(ctx.match[1]);
    if (!cbData) { await ctx.reply("⏳ Счёт устарел, попробуйте создать новый."); return; }
    const transactionId = cbData.transactionId;
    const subId         = cbData.subId;
    const tariffId      = cbData.tariffId;
    const userId        = BigInt(ctx.from.id);

    try {
      const payment = await prisma.payment.findUnique({ where: { id: transactionId } });
      if (!payment) { await ctx.reply("❌ Платёж не найден."); return; }
      if (payment.telegramUserId !== userId) { await ctx.reply("❌ Этот счёт не принадлежит вам."); return; }
      if (payment.status === "paid") {
        // Если processRenewal упал ранее (402), пробуем снова
        const sub = await prisma.subscription.findUnique({ where: { id: subId } });
        if (sub && new Date(sub.expiresAt) <= new Date(Date.now() - 60000)) {
          const tariffForBonus = TARIFFS.find((t) => t.id === tariffId);
          const bonusUsed = tariffForBonus ? Math.max(0, tariffForBonus.priceRub - payment.amount) : 0;
          await ctx.reply("🔄 Платёж обработан, продлеваю...");
          await processRenewal(ctx, userId, subId, tariffId, bonusUsed);
          return;
        }
        await ctx.reply("✅ Платёж уже обработан.");
        return;
      }

      const tariffForBonus = TARIFFS.find((t) => t.id === tariffId);
      const bonusUsed = tariffForBonus ? Math.max(0, tariffForBonus.priceRub - payment.amount) : 0;

      const result = await platega.checkStatus(transactionId);
      if (result.status === "CONFIRMED") {
        await markPlategalInvoicePaid(transactionId, async () => {
          await processRenewal(ctx, userId, subId, tariffId, bonusUsed);
        });
      } else if (result.status === "CANCELED" || result.status === "CHARGEBACKED") {
        await markPlategalInvoiceFailed(transactionId);
        await ctx.reply("❌ Платёж отменён. Попробуйте снова.");
      } else {
        await ctx.reply("⏳ Платёж ещё не поступил. Попробуйте чуть позже.");
      }
    } catch (err) {
      console.error("[check_platega_renew] Ошибка:", err);
      await ctx.reply("❌ Ошибка при проверке. Попробуйте позже.");
    }
  });

  function startRenewalPolling(
    invoiceId: number,
    userId: bigint,
    subId: string,
    tariffId: string,
    bonusUsed: number,
    chatId: number | string
  ): void {
    const MAX_ATTEMPTS = Math.floor(POLL_MAX_MS / POLL_INTERVAL_MS);
    let attempts = 0;

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) { clearInterval(interval); return; }

      try {
        const status = await cryptoBot.getInvoiceStatus(invoiceId);

        if (status === "paid") {
          clearInterval(interval);
          await markInvoicePaid(invoiceId, async () => {
            await processRenewal(chatId, userId, subId, tariffId, bonusUsed);
          });
        } else if (status === "expired" || status === "cancelled") {
          clearInterval(interval);
          await markInvoiceFailed(invoiceId);
        }
      } catch (err) {
        console.error(`[renew_poll] Ошибка проверки инвойса ${invoiceId}:`, err);
      }
    }, POLL_INTERVAL_MS);
  }

  bot.callbackQuery(/^check_renew:(\d+):([^:]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("🔍 Проверяем...");
    const invoiceId = parseInt(ctx.match[1]);
    const subId = ctx.match[2];
    const tariffId = ctx.match[3];
    const userId = BigInt(ctx.from.id);

    const status = await cryptoBot.getInvoiceStatus(invoiceId);
    if (status === "paid") {
      await markInvoicePaid(invoiceId, async () => {
        await processRenewal(ctx, userId, subId, tariffId, 0);
      });
    } else {
      await ctx.reply("⏳ Платёж ещё не получен. Попробуйте через 30 секунд.");
    }
  });

  async function processRenewal(
    target: { reply: Function } | number | string,
    userId: bigint,
    subId: string,
    tariffId: string,
    bonusUsed: number
  ): Promise<void> {
    try {
      // Получаем текущую подписку для получения vpnUserId (uuid)
      const sub = await prisma.subscription.findUnique({ where: { id: subId } });
      if (!sub) throw new Error("Subscription not found");

      // Ownership guard — prevent renewal from being applied to another user's subscription
      if (sub.telegramUserId !== userId) {
        throw new Error(`Renewal ownership mismatch: sub ${subId} belongs to ${sub.telegramUserId}, payer is ${userId}`);
      }

      const tariff = TARIFFS.find((t) => t.id === tariffId);
      if (!tariff) throw new Error("Tariff not found");

      // Renewal = add subscription to existing user
      const result = await royaltyKey.addSubscription(sub.id, tariff.apiDays, tariff.apiTariff);
      const expiresAt = new Date(Date.now() + tariff.durationDays * 86400000);

      await prisma.subscription.update({
        where: { id: subId },
        data: { expiresAt, tariffId },
      });

      if (bonusUsed > 0) {
        await prisma.user.update({
          where: { id: userId },
          data: { balance: { decrement: bonusUsed } },
        });
      }

      const expText = escapeMarkdown(formatDate(expiresAt));
      const renewSiteUrl = `https://autoconnect-chi.vercel.app/?key=${encodeURIComponent(sub.vpnKey)}`;
      const renewKeyboard = new InlineKeyboard()
        .url("🚀 Автоподключение", renewSiteUrl)
        .row()
        .text("ℹ️ Инструкция по настройке", "howto");
      const msg = `✅ *Подписка продлена\\!*\n\n📅 Действует до: *${expText}*\n\n${formatVpnKey(sub.vpnKey)}`;

      if (typeof target === "object" && "reply" in target) {
        await (target as { reply: Function }).reply(msg, { parse_mode: "MarkdownV2", reply_markup: renewKeyboard });
      } else {
        await bot.api.sendMessage(target as number, msg, { parse_mode: "MarkdownV2", reply_markup: renewKeyboard });
      }
    } catch (err) {
      console.error("[processRenewal] Ошибка:", err);
    }
  }

  bot.callbackQuery(/^buy_traffic:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId = ctx.match[1];
    const userId = BigInt(ctx.from.id);

    const sub = await prisma.subscription.findUnique({ where: { id: subId } });
    if (!sub || sub.telegramUserId !== userId) {
      await ctx.reply("❌ Подписка не найдена.");
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const pkg of EXTRA_TRAFFIC_PACKAGES) {
      keyboard.text(`${pkg.label} — ${pkg.priceRub} ₽`, `traffic_buy:${subId}:${pkg.gb}`).row();
    }
    keyboard.text("◀️ Назад", "profile");

    await ctx.reply(
      `📡 *Дополнительный трафик*\n\n` +
      `Выберите пакет дополнительного трафика для вашей LTE подписки:\n\n` +
      `📦 Доступные пакеты:`,
      { parse_mode: "MarkdownV2", reply_markup: keyboard }
    );
  });

  bot.callbackQuery(/^traffic_buy:([^:]+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subId = ctx.match[1];
    const gb = parseInt(ctx.match[2]);
    const userId = BigInt(ctx.from.id);

    const pkg = EXTRA_TRAFFIC_PACKAGES.find((p) => p.gb === gb);
    if (!pkg) {
      await ctx.reply("❌ Пакет не найден.");
      return;
    }

    const sub = await prisma.subscription.findUnique({ where: { id: subId } });
    if (!sub || sub.telegramUserId !== userId) {
      await ctx.reply("❌ Подписка не найдена.");
      return;
    }

    await ctx.reply("⏳ Покупаем дополнительный трафик...");

    try {
      const result = await royaltyKey.buyTraffic(sub.id, gb);
      await ctx.reply(
        `✅ *Дополнительный трафик активирован\\!*\n\n` +
        `📦 Пакет: *${escapeMarkdown(pkg.label)}*\n` +
        `💰 Сумма: *${escapeMarkdown(pkg.priceRub.toString())} ₽*`,
        { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("◀️ В профиль", "profile") }
      );
    } catch (err) {
      console.error("[buy_traffic] Ошибка:", err);
      const errMsg = err instanceof Error ? err.message : "Неизвестная ошибка";
      if (errMsg.includes("402")) {
        await ctx.reply("❌ Недостаточно средств на балансе API ключа.");
      } else if (errMsg.includes("400")) {
        await ctx.reply("❌ Неверный пакет или подписка не активна.");
      } else {
        await ctx.reply("❌ Не удалось купить трафик. Попробуйте позже.");
      }
    }
  });

  bot.callbackQuery("help", async (ctx) => {
    await ctx.answerCallbackQuery();
    const text =
      `🏆 *Сила нашего оберега*\n\n` +
      `⚡️ *Скорость северного ветра*\n` +
      `📶 Наши серверы выдают до 10 Гбит/с и минимальный пинг\\. Сеть работает без задержек\\.\n\n` +
      `🛡️ *Железная броня VLESS*\n` +
      `⚙️ Современные протоколы маскируют трафик под обычные сайты\\. Твоя приватность абсолютна\\.\n\n` +
      `🪵 *Три устройства на один оберег*\n` +
      `🎁 Мы не берем плату за новые гаджеты\\. К одному ключу можно подключить до 3 устройств твоей семьи\\.\n\n` +
      `🔑 *Ваш ключ — ваша безопасность\\!*\n` +
      `⚠️ Не передавай его чужакам, чтобы сохранить защиту и стабильность соединения\\.\n\n` +
      `*Часто задаваемые вопросы 👇*`;

    const keyboard = new InlineKeyboard()
      .text("⚔️ Распутать бурелом (Сбой)", "faq_vpn").row()
      .text("💰 Обменять золото (Оплата)", "faq_payment").row()
      .text("🔮 Призыв волхва (Поддержка)", "support").row()
      .text("📜 Документация", "docs").row()
      .text("↩️ Вернуться в чащу", "menu");

    await ctx.reply(text, {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery("faq_vpn", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `⚔️ *Распутать бурелом*\n\n` +
      `1\\. Проверь подключение к интернету\\.\n` +
      `2\\. Убедись, что ключ не истёк \\- загляни в "Личный чертог"\\.\n` +
      `3\\. Попробуй переустановить конфигурацию в V2rayNG или V2box\\.\n` +
      `4\\. Если бурелом не расступился \\- призови волхва\\.`,
      { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("↩️ Вернуться в чащу", "help") }
    );
  });

  bot.callbackQuery("faq_payment", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `💰 *Обменять золото*\n\n` +
      `1\\. CryptoBot: проверь, хватает ли USDT в кошельке\\.\n` +
      `2\\. Telegram Stars: спишутся сами, если звёзды есть на счету\\.\n` +
      `3\\. Если золото ушло, а оберег не пришёл \\- нажми "Я оплатил" под свитком или призови волхва\\.`,
      { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("↩️ Вернуться в чащу", "help") }
    );
  });

  bot.callbackQuery("support", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `🔮 *Призыв волхва*\n\n` +
      `📬 Отвечаем быстро\\!\n\n` +
      `Пиши по всем вопросам:\n` +
      `• Бурелом в соединении\n` +
      `• Золото не доходит\n` +
      `• Оберег сломался\n\n` +
      `Волхв: @morenavpnsupport\\_bot`,
      { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("↩️ Вернуться в чащу", "menu") }
    );
  });

  bot.callbackQuery("docs", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `📜 *Документация Morena VPN*`,
      {
        parse_mode: "MarkdownV2",
        reply_markup: new InlineKeyboard()
          .url("📋 Пользовательское соглашение", "https://telegra.ph/Polzovatelskoe-soglashenie-04-01-19").row()
          .url("📄 Политика конфиденциальности", "https://telegra.ph/Politika-konfidencialnosti-06-21-31").row()
          .text("↩️ Вернуться в чащу", "help"),
      }
    );
  });

  bot.callbackQuery("useful_bots", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `🤖 *Полезные боты*\n\n` +
      `Бот с подборкой полезных сервисов и инструментов для Telegram\\.\n\n` +
      `Переходи и выбирай нужное 👇`,
      {
        parse_mode: "MarkdownV2",
        reply_markup: new InlineKeyboard()
          .url("🤖 Открыть бота", "https://t.me/usefulbots2026_bot").row()
          .text("◀️ Назад", "menu"),
      }
    );
  });

  bot.callbackQuery("promo", async (ctx) => {
    await ctx.answerCallbackQuery();
    promoMode.add(ctx.from.id);
    await ctx.reply(
      `🎟️ *Введите промокод*\n\nОтправьте промокод следующим сообщением\\.`,
      { parse_mode: "MarkdownV2", reply_markup: new InlineKeyboard().text("◀️ Назад", "menu") }
    );
  });

  async function sendManual(ctx: { reply: Function }): Promise<void> {
    const keyboard = new InlineKeyboard()
      .url("📥 Скачать для Windows", "https://github.com/hiddify/hiddify-app/releases/latest")
      .row()
      .url("📥 Скачать для Android", "https://play.google.com/store/apps/details?id=app.hiddify.com")
      .row()
      .url("📥 Скачать для iOS", "https://apps.apple.com/app/hiddify/id6596777532")
      .row()
      .url("📥 Скачать для macOS", "https://github.com/hiddify/hiddify-app/releases/latest")
      .row()
      .url("📖 Полная инструкция на сайте", "https://autoconnect-chi.vercel.app")
      .row()
      .url("📱 Альтернатива", "https://teletype.in/@marksteal76/QXkpHJ7Z6DH")
      .row()
      .text("◀️ В меню", "menu");

    await ctx.reply(
      `📖 *Инструкция по настройке Morena VPN*\n\n` +
      `\\#\\#\\#\\# 1\\. Установка приложения\n\n` +
      `Скачайте и установите *Hiddify* для вашей платформы:\n\n` +
      `• *Windows / Linux* — [GitHub Releases](https://github.com/hiddify/hiddify-app/releases)\n` +
      `• *macOS* — [GitHub Releases](https://github.com/hiddify/hiddify-app/releases)\n` +
      `• *Android* — [Google Play](https://play.google.com/store/apps/details?id=app.hiddify.com)\n` +
      `• *iOS / iPadOS* — [App Store](https://apps.apple.com/app/hiddify/id6596777532)\n\n` +
      `Альтернативные клиенты: *V2rayNG* \\(Android\\) или *V2box* \\(iOS\\)\\.\n\n` +
      `\\#\\#\\#\\# 2\\. Добавление подписки\n\n` +
      `После покупки подписки в боте вы получите ключ доступа\\.\n\n` +
      `• Откройте Hiddify\n` +
      `• Нажмите \\"\\+\\" → \\"Добавить из буфера\\"\n` +
      `• Скопируйте ключ из бота и вставьте\n\n` +
      `\\#\\#\\#\\# 3\\. Подключение\n\n` +
      `• Нажмите на добавленный профиль\n` +
      `• Нажмите \\"Подключиться\\" / \\"Connect\\"\n` +
      `• Готово — вы в Morena VPN\\!\n\n` +
      `💡 *Совет:* если не работает — попробуйте переключить протокол или сервер в настройках приложения\\.\n\n` +
      `📄 [Политика конфиденциальности](https://telegra.ph/Politika-konfidencialnosti-06-21-31)\n` +
      `📋 [Пользовательское соглашение](https://telegra.ph/Polzovatelskoe-soglashenie-04-01-19)\n\n` +
      `По вопросам: @morenavpnsupport\\_bot`,
      { parse_mode: "MarkdownV2", reply_markup: keyboard }
    );
  }

  bot.callbackQuery("howto", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendManual(ctx);
  });

  bot.callbackQuery("menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(mainMenuText(), {
      parse_mode: "MarkdownV2",
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim().toLowerCase();

    if (text.startsWith("/")) return;

    if (text === "menu" || text === "главное меню") {
      await ctx.reply(mainMenuText(), {
        parse_mode: "MarkdownV2",
        reply_markup: mainMenuKeyboard(),
      });
      return;
    }

    if (text === "profile" || text === "личный кабинет") {
      const userId = BigInt(ctx.from.id);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const subs = await prisma.subscription.findMany({
        where: { telegramUserId: userId },
        orderBy: { expiresAt: "desc" },
      });
      const botUsername = (await bot.api.getMe()).username;
      const refLink = escapeMarkdown(`https://t.me/${botUsername}?start=ref_${userId}`);

      let profileText =
        `👤 *Личный чертог*\n\n` +
        `🔔 Ваш ID: \`${userId}\`\n` +
        `💰 Бонусный баланс: *${escapeMarkdown((user?.balance ?? 0).toString())} ₽*\n` +
        `🔗 Реферальная ссылка:\n\`${refLink}\`\n\n`;

      const keyboard = new InlineKeyboard();
      if (subs.length === 0) {
        profileText += `📭 У вас нет активных подписок\\.`;
      } else {
        profileText += `📋 *Ваши подписки:*\n\n`;
        subs.forEach((sub, i) => {
          const status = subStatus(sub);
          const expiry = escapeMarkdown(formatDate(new Date(sub.expiresAt)));
          const isObhod = sub.tariffId.startsWith("obhod_");
          profileText += `${i + 1}\\. ${status}` + (isObhod ? " 🌌" : "") + `\n   📅 До: ${expiry}\n\n`;
          keyboard.text(`🔄 Продлить #${i + 1}`, `renew_sub:${sub.id}`).row();
          if (isObhod && subStatus(sub) === "🟢 Активна") {
            keyboard.text(`📡 Трафик #${i + 1}`, `buy_traffic:${sub.id}`).row();
          }
        });
      }
      keyboard.text("◀️ В меню", "menu");
      await ctx.reply(profileText, { parse_mode: "MarkdownV2", reply_markup: keyboard });
      return;
    }

    if (text === "help" || text === "помощь") {
      await ctx.reply(
        `❓ *Помощь по боту Morena VPN*\n\n` +
        `Доступные команды:\n` +
        `• /start — Запустить бота\n` +
        `• /menu — Главное меню\n` +
        `• /profile — Личный кабинет\n` +
        `• /help — Помощь\n\n` +
      `По вопросам: @morenavpnsupport\\_bot`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    const userId = BigInt(ctx.from.id);

    const gState = giftState.get(ctx.from.id);
    if (gState && gState.step === "awaiting_recipient") {
      const raw = ctx.message.text.trim();
      const recipient = raw.startsWith("@") ? raw.slice(1) : raw;
      if (!recipient || recipient.length < 2) {
        await ctx.reply("❌ Укажите корректный username.");
        return;
      }
      giftState.delete(ctx.from.id);
      const tariff = TARIFFS.find((t) => t.id === gState.tariffId);
      if (!tariff) { await ctx.reply("❌ Тариф не найден."); return; }

      const keyboard = new InlineKeyboard()
        .text("⚡ CryptoBot (USDT)", `gift_pay_crypto:${gState.tariffId}:${recipient}`).row()
        .text("⭐ Telegram Stars", `gift_pay_stars:${gState.tariffId}:${recipient}`).row()
        .text("💳 Картой (РФ)", `gift_pay_card:${gState.tariffId}:${recipient}`).row()
        .text("📲 СБП", `gift_pay_sbp:${gState.tariffId}:${recipient}`).row()
        .text("◀️ Назад", "gift");

      await ctx.reply(
        `🎁 Подарок для *@${escapeMarkdown(recipient)}*\n📦 *${escapeMarkdown(tariff.label)}*\n\nВыберите способ оплаты:`,
        { parse_mode: "MarkdownV2", reply_markup: keyboard }
      );
      return;
    }

    if (!promoMode.has(ctx.from.id)) return;

    promoMode.delete(ctx.from.id);

    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, username: ctx.from.username ?? null },
      update: {},
    });

    try {
      const code = text.toUpperCase();
      const promo = await prisma.promocode.findUnique({ where: { id: code } });

      if (!promo) {
        await ctx.reply(
          `❌ Промокод *${escapeMarkdown(code)}* не найден\\.`,
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      if (promo.usesCount >= promo.maxUses) {
        await ctx.reply("❌ Этот промокод уже исчерпал лимит использований.");
        return;
      }

      const alreadyUsed = await prisma.usedPromocode.findUnique({
        where: { userId_promocodeId: { userId, promocodeId: code } },
      });

      if (alreadyUsed) {
        await ctx.reply("❌ Вы уже использовали этот промокод.");
        return;
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { balance: { increment: promo.bonusAmount } },
        }),
        prisma.promocode.update({
          where: { id: code },
          data: { usesCount: { increment: 1 } },
        }),
        prisma.usedPromocode.create({
          data: { userId, promocodeId: code },
        }),
      ]);

      await ctx.reply(
        `✅ Промокод *${escapeMarkdown(code)}* активирован\\!\n\n` +
          `💰 Вам начислено *${escapeMarkdown(promo.bonusAmount.toString())} ₽* бонуса\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      console.error("[promo] Ошибка обработки промокода:", err);
      await ctx.reply("❌ Ошибка при активации промокода. Попробуйте позже.");
    }
  });

  bot.catch((err) => {
    console.error("[bot] Необработанная ошибка:", err.error);
  });

  bot.command("menu", async (ctx) => {
    await ctx.reply(mainMenuText(), {
      parse_mode: "MarkdownV2",
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.command("manual", async (ctx) => {
    await sendManual(ctx);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `❓ *Помощь по боту Morena VPN*\n\n` +
      `Доступные команды:\n` +
      `• /start — Запустить бота и получить меню\n` +
      `• /menu — Показать главное меню\n` +
      `• /profile — Личный кабинет\n` +
      `• /manual — Инструкция по настройке\n` +
`• /help — Эта справка\n\n` +
      `По вопросам: @morenavpnsupport\\_bot`,
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.command("docs", async (ctx) => {
    console.log("[docs] Команда /docs получена от", ctx.from?.id);
    try {
      await ctx.reply(
        "📖 *Документация Morena VPN*\n\n" +
        "• 📄 [Пользовательское соглашение](https://telegra.ph/Polzovatelskoe-soglashenie-04-01-19)\n" +
        "• 🔏 [Политика конфиденциальности](https://telegra.ph/Politika-konfidencialnosti-06-21-31)\n" +
        "• 📱 [Инструкция по настройке](https://teletype.in/@marksteal76/QXkpHJ7Z6DH)\n\n" +
        "По всем вопросам: @morenavpnsupport\\_bot",
        {
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
        } as any
      );
    } catch (err) {
      console.error("[docs] Ошибка:", err);
    }
  });
}

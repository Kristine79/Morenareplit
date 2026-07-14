import { Router } from "express";
import axios from "axios";
import type { Request, Response } from "express";
import { prisma } from "../../prisma.js";
import { requireAuth } from "../middleware/jwt.js";
import { logger } from "../lib/logger.js";

export const plategalRouter = Router();

const PLATEGA_MERCHANT_ID = process.env.PLATEGA_MERCHANT_ID;
const PLATEGA_SECRET      = process.env.PLATEGA_SECRET;
const BOT_TOKEN           = process.env.BOT_TOKEN;
const BASE_URL            = "https://app.platega.io";
const ROYALTYKEY_BASE     = "https://royaltykey.com/api";

function plategalHeaders() {
  return {
    "X-MerchantId": PLATEGA_MERCHANT_ID ?? "",
    "X-Secret":     PLATEGA_SECRET      ?? "",
    "Content-Type": "application/json",
  };
}

async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id:    chatId,
      text,
      parse_mode: "MarkdownV2",
    });
  } catch (err) {
    logger.error({ err, chatId }, "[platega_webhook] Failed to send Telegram notification");
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

async function createVpnSubscription(
  apiTariff: string,
  apiDays: number
): Promise<{ uuid: string; subscriptionUrl: string }> {
  const ROYALTYKEY_API_KEY = process.env.ROYALTYKEY_API_KEY;
  const createRes = await axios.post(
    `${ROYALTYKEY_BASE}/create`,
    {},
    { headers: { "x-api-key": ROYALTYKEY_API_KEY ?? "" } }
  );
  const uuid: string = createRes.data.uuid;

  const subRes = await axios.post(
    `${ROYALTYKEY_BASE}/add-subscription`,
    { uuid, days: apiDays, tariff: apiTariff },
    { headers: { "x-api-key": ROYALTYKEY_API_KEY ?? "" } }
  );
  const subscriptionUrl: string = subRes.data.subscription_url ?? subRes.data.url ?? "";

  return { uuid, subscriptionUrl };
}

async function extendVpnSubscription(
  uuid: string,
  apiTariff: string,
  apiDays: number
): Promise<void> {
  const ROYALTYKEY_API_KEY = process.env.ROYALTYKEY_API_KEY;
  await axios.post(
    `${ROYALTYKEY_BASE}/add-subscription`,
    { uuid, days: apiDays, tariff: apiTariff },
    { headers: { "x-api-key": ROYALTYKEY_API_KEY ?? "" } }
  );
}

const TARIFF_MAP: Record<string, { apiTariff: string; apiDays: number; durationDays: number }> = {
  classic_7days:   { apiTariff: "regular", apiDays: 7,   durationDays: 7   },
  classic_30days:  { apiTariff: "regular", apiDays: 30,  durationDays: 30  },
  classic_90days:  { apiTariff: "regular", apiDays: 90,  durationDays: 90  },
  classic_180days: { apiTariff: "regular", apiDays: 180, durationDays: 180 },
  classic_365days: { apiTariff: "regular", apiDays: 365, durationDays: 365 },
  obhod_7days:     { apiTariff: "lte",     apiDays: 7,   durationDays: 7   },
  obhod_30days:    { apiTariff: "lte",     apiDays: 30,  durationDays: 30  },
  obhod_90days:    { apiTariff: "lte",     apiDays: 90,  durationDays: 90  },
  obhod_180days:   { apiTariff: "lte",     apiDays: 180, durationDays: 180 },
  obhod_365days:   { apiTariff: "lte",     apiDays: 365, durationDays: 365 },
};

plategalRouter.get("/platega/webhook", (_req: Request, res: Response) => {
  res.status(200).send("OK");
});

plategalRouter.post("/platega/webhook", async (req: Request, res: Response) => {
  const incomingMerchantId = req.headers["x-merchantid"] as string ?? "";
  const incomingSecret     = req.headers["x-secret"]     as string ?? "";

  if (!PLATEGA_MERCHANT_ID || !PLATEGA_SECRET) {
    logger.warn("[platega_webhook] PLATEGA_MERCHANT_ID or PLATEGA_SECRET not configured — rejecting");
    res.status(503).json({ error: "Platega not configured" });
    return;
  }

  if (incomingMerchantId !== PLATEGA_MERCHANT_ID || incomingSecret !== PLATEGA_SECRET) {
    logger.warn({ incomingMerchantId }, "[platega_webhook] Invalid credentials — rejected");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as {
    id: string;
    amount: number;
    currency: string;
    status: "CONFIRMED" | "CANCELED";
    paymentMethod?: number;
    payload: string;
  };

  const { id: transactionId, status, payload, amount } = body;

  logger.info({ transactionId, status, payload }, "[platega_webhook] Received callback");

  res.status(200).send("OK");

  setImmediate(async () => {
    try {
      const payment = await prisma.payment.findUnique({ where: { id: transactionId } });

      if (!payment) {
        logger.warn({ transactionId }, "[platega_webhook] Payment record not found in DB");
        return;
      }

      if (payment.status === "paid") {
        logger.info({ transactionId }, "[platega_webhook] Already processed — skipping");
        return;
      }

      const userId = payment.telegramUserId;

      if (status === "CANCELED") {
        await prisma.payment.updateMany({
          where: { id: transactionId, status: "pending" },
          data: { status: "failed" },
        });
        logger.info({ transactionId }, "[platega_webhook] Marked as failed");

        await sendTelegramMessage(
          userId.toString(),
          `❌ Платёж по счёту отменён\\. Попробуйте снова — /start`
        );
        return;
      }

      if (status !== "CONFIRMED") {
        logger.info({ transactionId, status }, "[platega_webhook] Unhandled status — ignoring");
        return;
      }

      const updated = await prisma.payment.updateMany({
        where: { id: transactionId, status: "pending" },
        data: { status: "paid" },
      });

      if (updated.count === 0) {
        logger.info({ transactionId }, "[platega_webhook] Race-condition: already paid — skipping");
        return;
      }

      const parts = payload.split(":");
      const action = parts[0];

      if (action === "buy" && parts.length >= 3) {
        const tariffId    = parts[1];
        const telegramId  = parts[2];
        const tariff = TARIFF_MAP[tariffId];

        if (!tariff) {
          logger.error({ tariffId }, "[platega_webhook] Unknown tariffId");
          await sendTelegramMessage(telegramId, `❌ Ошибка: неизвестный тариф\\. Обратитесь в поддержку\\.`);
          return;
        }

        const { uuid, subscriptionUrl } = await createVpnSubscription(tariff.apiTariff, tariff.apiDays);
        const expiresAt = new Date(Date.now() + tariff.durationDays * 86400000);

        await prisma.subscription.create({
          data: {
            id: uuid,
            telegramUserId: BigInt(telegramId),
            vpnKey: subscriptionUrl,
            tariffId,
            expiresAt,
          },
        });

        const autoConnectUrl = `https://autoconnect-chi.vercel.app/?key=${encodeURIComponent(subscriptionUrl)}`;
        const expiresText = escapeMarkdown(expiresAt.toLocaleDateString("ru-RU"));

        await sendTelegramMessage(
          telegramId,
          `🎉 *Оплата прошла успешно\\!*\n\n` +
          `🔑 Ваш ключ:\n\`${escapeMarkdown(subscriptionUrl)}\`\n\n` +
          `📅 Действует до: *${expiresText}*\n\n` +
          `🚀 [Автоподключение](${escapeMarkdown(autoConnectUrl)})`
        );

        logger.info({ transactionId, uuid, telegramId }, "[platega_webhook] VPN access granted");

      } else if (action === "renew" && parts.length >= 4) {
        const subId      = parts[1];
        const tariffId   = parts[2];
        const telegramId = parts[3];
        const tariff = TARIFF_MAP[tariffId];

        if (!tariff) {
          logger.error({ tariffId }, "[platega_webhook] Unknown tariffId for renewal");
          await sendTelegramMessage(telegramId, `❌ Ошибка при продлении\\. Обратитесь в поддержку\\.`);
          return;
        }

        const sub = await prisma.subscription.findUnique({ where: { id: subId } });

        if (!sub) {
          logger.error({ subId }, "[platega_webhook] Subscription not found for renewal");
          await sendTelegramMessage(telegramId, `❌ Подписка не найдена\\. Обратитесь в поддержку\\.`);
          return;
        }

        if (String(sub.telegramUserId) !== String(telegramId)) {
          logger.error({ subId, subOwner: sub.telegramUserId, payer: telegramId }, "[platega_webhook] Renewal ownership mismatch — rejected");
          await sendTelegramMessage(telegramId, `❌ Ошибка: эта подписка принадлежит другому пользователю\\.`);
          return;
        }

        await extendVpnSubscription(subId, tariff.apiTariff, tariff.apiDays);

        const currentExpiry = new Date(sub.expiresAt);
        const newExpiry = new Date(
          Math.max(currentExpiry.getTime(), Date.now()) + tariff.durationDays * 86400000
        );

        await prisma.subscription.update({
          where: { id: subId },
          data: { expiresAt: newExpiry },
        });

        const expiresText = escapeMarkdown(newExpiry.toLocaleDateString("ru-RU"));
        await sendTelegramMessage(
          telegramId,
          `✅ *Подписка продлена\\!*\n\n📅 Новый срок: *${expiresText}*`
        );

        logger.info({ transactionId, subId, telegramId }, "[platega_webhook] Subscription renewed");

      } else if (action === "gift_buy" && parts.length >= 4) {
        const tariffId    = parts[1];
        const recipientUsername = parts[2];
        const gifterId    = parts[3];
        const tariff = TARIFF_MAP[tariffId];

        if (!tariff) {
          logger.error({ tariffId }, "[platega_webhook] Unknown tariffId for gift");
          await sendTelegramMessage(gifterId, `❌ Ошибка при создании подарка\\. Обратитесь в поддержку\\.`);
          return;
        }

        const { uuid, subscriptionUrl } = await createVpnSubscription(tariff.apiTariff, tariff.apiDays);
        const expiresAt = new Date(Date.now() + tariff.durationDays * 86400000);
        const expiresText = escapeMarkdown(expiresAt.toLocaleDateString("ru-RU"));

        const recipient = await prisma.user.findFirst({ where: { username: recipientUsername } });
        const recipientId = recipient?.id ?? null;
        const storeUserId = recipientId ?? BigInt(gifterId);

        await prisma.subscription.create({
          data: {
            id: uuid,
            telegramUserId: storeUserId,
            vpnKey: subscriptionUrl,
            tariffId,
            expiresAt,
          },
        });

        const autoConnectUrl = `https://autoconnect-chi.vercel.app/?key=${encodeURIComponent(subscriptionUrl)}`;

        await sendTelegramMessage(
          gifterId,
          `🎁 *Подарок отправлен\\!*\n\n` +
          `👤 Получатель: *@${escapeMarkdown(recipientUsername)}*\n` +
          `🔑 Ключ:\n\`${escapeMarkdown(subscriptionUrl)}\`\n` +
          `📅 Действует до: *${expiresText}*`
        );

        if (recipientId) {
          await sendTelegramMessage(
            recipientId.toString(),
            `🎁 *Вам подарили VPN\\!*\n\n` +
            `🔑 Ваш ключ:\n\`${escapeMarkdown(subscriptionUrl)}\`\n\n` +
            `📅 Действует до: *${expiresText}*\n\n` +
            `🚀 [Автоподключение](${escapeMarkdown(autoConnectUrl)})`
          );
        }

        logger.info({ transactionId, uuid, gifterId, recipientUsername }, "[platega_webhook] Gift VPN granted");

      } else {
        logger.warn({ transactionId, payload, action }, "[platega_webhook] Unknown payload format");
      }

    } catch (err) {
      logger.error({ err, transactionId }, "[platega_webhook] Error processing confirmed payment");
    }
  });
});

plategalRouter.get("/admin/platega/balance", requireAuth, async (_req: Request, res: Response) => {
  if (!PLATEGA_MERCHANT_ID || !PLATEGA_SECRET) {
    res.status(503).json({ error: "Platega not configured" });
    return;
  }

  try {
    const response = await axios.get(`${BASE_URL}/transaction/balance`, {
      headers: plategalHeaders(),
    });
    res.json(response.data);
  } catch (err) {
    logger.error({ err }, "[admin/platega/balance] Failed to fetch balances");
    const status = (err as { response?: { status: number } })?.response?.status ?? 502;
    res.status(status).json({ error: "Failed to fetch Platega balance" });
  }
});

plategalRouter.post("/admin/platega/transactions", requireAuth, async (req: Request, res: Response) => {
  if (!PLATEGA_MERCHANT_ID || !PLATEGA_SECRET) {
    res.status(503).json({ error: "Platega not configured" });
    return;
  }

  const { from, to, statuses, paymentMethods, timeZoneId } = req.body as {
    from?: string;
    to?: string;
    statuses?: string[];
    paymentMethods?: string[];
    timeZoneId?: string;
  };

  if (!from || !to) {
    res.status(400).json({ error: "from and to are required" });
    return;
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/transaction/export/json`,
      { from, to, statuses, paymentMethods, timeZoneId: timeZoneId ?? "UTC" },
      { headers: plategalHeaders() }
    );
    res.json(response.data);
  } catch (err) {
    logger.error({ err }, "[admin/platega/transactions] Failed to export transactions");
    const status = (err as { response?: { status: number } })?.response?.status ?? 502;
    res.status(status).json({ error: "Failed to export Platega transactions" });
  }
});

plategalRouter.get("/admin/platega/conversions", requireAuth, async (_req: Request, res: Response) => {
  if (!PLATEGA_MERCHANT_ID || !PLATEGA_SECRET) {
    res.status(503).json({ error: "Platega not configured" });
    return;
  }

  try {
    const response = await axios.get(`${BASE_URL}/transaction/conversions`, {
      headers: plategalHeaders(),
    });
    res.json(response.data);
  } catch (err) {
    logger.error({ err }, "[admin/platega/conversions] Failed to fetch conversions");
    res.status(502).json({ error: "Failed to fetch Platega conversions" });
  }
});



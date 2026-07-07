/**
 * CRON-задачи для авто-уведомлений об истечении подписок
 *
 * Каждый день в 12:00 ищет подписки, истекающие через 3 дня и через 1 день,
 * и отправляет пользователям напоминания с кнопкой продления.
 */

import cron from "node-cron";
import { Bot, InlineKeyboard } from "grammy";
import { prisma } from "./db.js";
import { escapeMarkdown, formatDate } from "./helpers.js";

/**
 * Рассчитать диапазон дат для поиска истекающих подписок
 * @param daysFromNow - через сколько дней истекает
 * @returns [start, end] — диапазон в пределах этого дня
 */
function getDateRange(daysFromNow: number): [Date, Date] {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setHours(23, 59, 59, 999);

  return [start, end];
}

/**
 * Запустить CRON-задачи уведомлений
 */
export function startCronJobs(bot: Bot): void {
  // Каждый день в 12:00 по московскому времени (UTC+3 → UTC 09:00)
  cron.schedule("0 9 * * *", async () => {
    console.log("[CRON] Запуск проверки истекающих подписок...");

    // Уведомления за 3 дня и за 1 день
    for (const daysLeft of [3, 1]) {
      const [start, end] = getDateRange(daysLeft);

      try {
        // Ищем подписки, которые истекают именно через daysLeft дней
        const expiringSubs = await prisma.subscription.findMany({
          where: {
            expiresAt: { gte: start, lte: end },
          },
        });

        console.log(
          `[CRON] Найдено ${expiringSubs.length} подписок, истекающих через ${daysLeft} дн.`
        );

        for (const sub of expiringSubs) {
          try {
            const daysText = daysLeft === 1 ? "завтра" : `через ${daysLeft} дня`;
            const expiryDate = escapeMarkdown(formatDate(new Date(sub.expiresAt)));

            // Fetch bot username dynamically for deep links
            const botInfo = await bot.api.getMe();
            const botUsername = process.env.BOT_USERNAME ?? botInfo.username;

            const keyboard = new InlineKeyboard().url(
              `⚡ Продлить подписку`,
              `https://t.me/${botUsername}?start=renew_${sub.id}`
            );

            // FIX #1: Use .toString() instead of Number() to preserve BigInt precision
            await bot.api.sendMessage(
              sub.telegramUserId.toString(),
              `⚠️ *Внимание\\!* Ваша подписка Morena VPN истекает *${daysText}* \\(${expiryDate}\\)\\.\n\n` +
                `Продлите её сейчас, чтобы не потерять доступ к VPN\\.`,
              {
                parse_mode: "MarkdownV2",
                reply_markup: keyboard,
              }
            );

            console.log(
              `[CRON] Уведомление отправлено пользователю ${sub.telegramUserId} (через ${daysLeft} дн.)`
            );
          } catch (err) {
            // Пользователь мог заблокировать бота — логируем и продолжаем
            console.error(
              `[CRON] Ошибка отправки уведомления пользователю ${sub.telegramUserId}:`,
              err
            );
          }
        }
      } catch (err) {
        console.error(`[CRON] Ошибка при поиске подписок через ${daysLeft} дн.:`, err);
      }
    }
  });

  console.log("[CRON] Задачи уведомлений запущены (каждый день в 12:00 МСК)");
}

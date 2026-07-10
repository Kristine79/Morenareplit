import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Bot, InlineKeyboard } from "grammy";
import { prisma } from "../../lib/prisma.js";

const BOT_TOKEN = process.env.BOT_TOKEN;

function getDateRange(daysFromNow: number): [Date, Date] {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setHours(23, 59, 59, 999);

  return [start, end];
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\:]/g, "\\$&");
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (!BOT_TOKEN) {
    res.status(503).json({ error: "Bot not configured" });
    return;
  }

  const bot = new Bot(BOT_TOKEN);
  const results: string[] = [];

  for (const daysLeft of [3, 1]) {
    const [start, end] = getDateRange(daysLeft);

    try {
      const expiringSubs = await prisma.subscription.findMany({
        where: {
          expiresAt: { gte: start, lte: end },
        },
      });

      results.push(`Found ${expiringSubs.length} subscriptions expiring in ${daysLeft} day(s)`);

      for (const sub of expiringSubs) {
        try {
          const daysText = daysLeft === 1 ? "завтра" : `через ${daysLeft} дня`;
          const expiryDate = escapeMarkdown(formatDate(new Date(sub.expiresAt)));
          const botInfo = await bot.api.getMe();
          const botUsername = process.env.BOT_USERNAME ?? botInfo.username;

          const keyboard = new InlineKeyboard().url(
            `⚡ Продлить подписку`,
            `https://t.me/${botUsername}?start=renew_${sub.id}`
          );

          await bot.api.sendMessage(
            sub.telegramUserId.toString(),
            `⚠️ *Внимание\\!* Ваша подписка Morena VPN истекает *${daysText}* \\(${expiryDate}\\)\\.\n\n` +
              `Продлите её сейчас, чтобы не потерять доступ к VPN\\.`,
            {
              parse_mode: "MarkdownV2",
              reply_markup: keyboard,
            }
          );

          results.push(`Notified user ${sub.telegramUserId} (expires in ${daysLeft} day(s))`);
        } catch (err) {
          results.push(`Failed to notify user ${sub.telegramUserId}: ${err}`);
        }
      }
    } catch (err) {
      results.push(`Error querying subscriptions for ${daysLeft} day(s): ${err}`);
    }
  }

  res.status(200).json({ ok: true, results });
}

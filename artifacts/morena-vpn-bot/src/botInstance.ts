/**
 * Configured Bot instance for use in both the standalone bot process
 * and the API-server webhook handler.
 */

import "dotenv/config";
import { Bot } from "grammy";
import { setupBotHandlers } from "./botHandlers.js";
import { prisma } from "./db.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN не задан");

export const bot = new Bot(BOT_TOKEN);
setupBotHandlers(bot);

// Track user activity on any interaction
bot.on(["message", "callback_query"], async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId) {
    prisma.user
      .update({
        where: { id: userId },
        data: { lastActivityAt: new Date() },
      })
      .catch(() => {
        /* user may not exist yet */
      });
  }
  await next();
});

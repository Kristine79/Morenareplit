import { Router, type IRouter, type Request, type Response } from "express";
import { type Bot } from "grammy";
import { type Update } from "@grammyjs/types";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const botPromise: Promise<Bot | null> = BOT_TOKEN
  ? import("@workspace/morena-vpn-bot/src/botInstance.js").then(
      (module) => module.bot as Bot,
    )
  : Promise.resolve(null);

function verifySecretToken(req: Request): boolean {
  if (!WEBHOOK_SECRET) {
    // If webhook mode is in use without a secret, reject all requests for safety.
    // Set WEBHOOK_SECRET to enable webhook mode with proper verification.
    logger.error("WEBHOOK_SECRET не задан — все webhook запросы отклоняются");
    return false;
  }
  const header = req.headers["x-telegram-bot-api-secret-token"];
  return header === WEBHOOK_SECRET;
}

router.post("/bot/webhook", async (req: Request, res: Response): Promise<void> => {
  const bot = await botPromise;

  if (!bot) {
    res.status(503).json({ error: "Bot webhook is not configured" });
    return;
  }

  if (!verifySecretToken(req)) {
    logger.warn({ ip: req.ip }, "Webhook verification failed — invalid secret token");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const update: Update = req.body as Update;

  if (!update || !update.update_id) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }

  try {
    await bot.handleUpdate(update);
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err, updateId: update.update_id }, "Bot webhook update handling failed");
    res.status(200).json({ ok: true });
  }
});

export default router;

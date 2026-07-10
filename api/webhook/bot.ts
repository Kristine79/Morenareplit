import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Update } from "@grammyjs/types";

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!BOT_TOKEN) {
    res.status(503).json({ error: "Bot not configured" });
    return;
  }

  const secretToken = req.headers["x-telegram-bot-api-secret-token"] as string | undefined;
  if (WEBHOOK_SECRET && secretToken !== WEBHOOK_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { bot } = await import("../../artifacts/morena-vpn-bot/src/botInstance.js");
    const update: Update = req.body as Update;

    if (!update || !update.update_id) {
      res.status(400).json({ error: "Invalid update" });
      return;
    }

    await bot.handleUpdate(update);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[bot-webhook] Error handling update:", err);
    res.status(200).json({ ok: true });
  }
}

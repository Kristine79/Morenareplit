import { Router } from "express";
import type { Request, Response } from "express";
import type { Update } from "@grammyjs/types";
import { prisma } from "../../../lib/prisma.js";
import { logger } from "../lib/logger.js";

export const webhookRouter = Router();

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

webhookRouter.post("/webhook/bot", async (req: Request, res: Response) => {
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
    const { bot } = await import("../../../artifacts/morena-vpn-bot/src/botInstance.js");
    const update: Update = req.body as Update;

    if (!update || !update.update_id) {
      res.status(400).json({ error: "Invalid update" });
      return;
    }

    await bot.handleUpdate(update);
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[bot-webhook] Error handling update");
    res.status(200).json({ ok: true });
  }
});

webhookRouter.get("/webhook/crypto-bot", (_req: Request, res: Response) => {
  res.status(200).send("OK");
});

webhookRouter.post("/webhook/crypto-bot", async (req: Request, res: Response) => {
  const body = req.body as {
    update_id: number;
    update_type: "invoice_paid" | "invoice_expired";
    payload: {
      invoice_id: number;
      status: "active" | "paid" | "expired";
      hash: string;
      asset: string;
      amount: string;
      paid_anonymously?: boolean;
      pay_url?: string;
      description?: string;
      payload?: string;
    };
  };

  if (!body.payload || !body.payload.invoice_id) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const invoiceId = body.payload.invoice_id.toString();
  const status = body.payload.status;

  logger.info({ invoiceId, status }, "[cryptobot-webhook] Invoice update");

  if (status !== "paid") {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const payment = await prisma.payment.findUnique({ where: { id: invoiceId } });

    if (!payment) {
      logger.warn({ invoiceId }, "[cryptobot-webhook] Payment not found");
      res.status(200).json({ ok: true });
      return;
    }

    if (payment.status === "paid") {
      logger.info({ invoiceId }, "[cryptobot-webhook] Already processed");
      res.status(200).json({ ok: true });
      return;
    }

    await prisma.payment.update({
      where: { id: invoiceId },
      data: { status: "paid" },
    });

    logger.info({ invoiceId }, "[cryptobot-webhook] Marked as paid");
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err, invoiceId }, "[cryptobot-webhook] Error processing payment");
    res.status(200).json({ ok: true });
  }
});

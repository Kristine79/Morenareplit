import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../../lib/prisma.js";

interface CryptoBotWebhookPayload {
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
}

export async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body as CryptoBotWebhookPayload;

  if (!body.payload || !body.payload.invoice_id) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const invoiceId = body.payload.invoice_id.toString();
  const status = body.payload.status;

  console.log(`[cryptobot-webhook] Invoice ${invoiceId} status: ${status}`);

  if (status !== "paid") {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const payment = await prisma.payment.findUnique({ where: { id: invoiceId } });

    if (!payment) {
      console.log(`[cryptobot-webhook] Payment ${invoiceId} not found in DB`);
      res.status(200).json({ ok: true });
      return;
    }

    if (payment.status === "paid") {
      console.log(`[cryptobot-webhook] Payment ${invoiceId} already processed`);
      res.status(200).json({ ok: true });
      return;
    }

    await prisma.payment.update({
      where: { id: invoiceId },
      data: { status: "paid" },
    });

    console.log(`[cryptobot-webhook] Payment ${invoiceId} marked as paid`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`[cryptobot-webhook] Error processing payment ${invoiceId}:`, err);
    res.status(200).json({ ok: true });
  }
}

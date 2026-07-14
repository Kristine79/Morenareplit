import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../middleware/jwt.js";
import axios from "axios";
import {
  GetResellerProfileResponse,
  CreateResellerClientBody,
  CreateResellerClientResponse,
  RenewSubscriptionBody,
  RenewSubscriptionResponse,
  DeleteSubscriptionResponse,
} from "@workspace/api-zod";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../lib/logger.js";

export const resellerRouter = Router();

resellerRouter.use("/admin", requireAuth);

const ROYALTYKEY_BASE = "https://royaltykey.com/api/v1";

function getApiHeaders() {
  const token = process.env.ROYALTYKEY_API_KEY;
  if (!token) throw new Error("ROYALTYKEY_API_KEY не задан");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

resellerRouter.get("/admin/reseller/profile", async (req: Request, res: Response): Promise<void> => {
  try {
    const apiKey = process.env.ROYALTYKEY_API_KEY;
    if (!apiKey) throw new Error("ROYALTYKEY_API_KEY не задан");
    const response = await axios.get(`https://api.royaltykey.ru/${apiKey}/balance`);
    const data = response.data as { balance: number };
    res.json(GetResellerProfileResponse.parse({
      balance: data.balance,
      discount: 0,
    }));
  } catch (err: unknown) {
    req.log?.error?.({ err }, "RoyaltyKey getProfile failed");
    res.status(502).json({ error: "Ошибка запроса к RoyaltyKey API" });
  }
});

resellerRouter.post("/admin/reseller/clients", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateResellerClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { tariffId, label } = parsed.data;

  try {
    const response = await axios.post(
      `${ROYALTYKEY_BASE}/users`,
      { tariff_id: tariffId, external_id: label ?? `admin_${Date.now()}` },
      { headers: getApiHeaders() }
    );
    const user = response.data as { id: string; vpn_key: string; expires_at: string; tariff_id: string };
    res.status(201).json(CreateResellerClientResponse.parse({
      id: user.id,
      vpnKey: user.vpn_key,
      expiresAt: user.expires_at,
      tariffId: user.tariff_id,
    }));
  } catch (err: unknown) {
    req.log?.error?.({ err }, "RoyaltyKey createUser failed");
    res.status(502).json({ error: "Ошибка создания клиента в RoyaltyKey API" });
  }
});

resellerRouter.post("/admin/subscriptions/:id/renew", async (req: Request, res: Response): Promise<void> => {
  const subId = req.params.id as string;
  const parsed = RenewSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { tariffId } = parsed.data;

  try {
    const sub = await prisma.subscription.findUnique({ where: { id: subId } });
    if (!sub) {
      res.status(404).json({ error: "Подписка не найдена" });
      return;
    }

    const response = await axios.post(
      `${ROYALTYKEY_BASE}/users/${subId}/renew`,
      { tariff_id: tariffId },
      { headers: getApiHeaders() }
    );
    const user = response.data as { id: string; vpn_key: string; expires_at: string; tariff_id: string };

    await prisma.subscription.update({
      where: { id: subId },
      data: { expiresAt: new Date(user.expires_at), tariffId: user.tariff_id },
    });

    res.json(RenewSubscriptionResponse.parse({
      id: user.id,
      vpnKey: user.vpn_key,
      expiresAt: user.expires_at,
      tariffId: user.tariff_id,
    }));
  } catch (err: unknown) {
    req.log?.error?.({ err }, "RoyaltyKey renewSubscription failed");
    res.status(502).json({ error: "Ошибка продления в RoyaltyKey API" });
  }
});

resellerRouter.delete("/admin/subscriptions/:id", async (req: Request, res: Response): Promise<void> => {
  const subId = req.params.id as string;

  try {
    const sub = await prisma.subscription.findUnique({ where: { id: subId } });
    if (!sub) {
      res.status(404).json({ error: "Подписка не найдена" });
      return;
    }

    try {
      await axios.delete(`${ROYALTYKEY_BASE}/users/${subId}`, {
        headers: getApiHeaders(),
      });
    } catch (err: unknown) {
      req.log?.warn?.({ err }, "RoyaltyKey deleteUser failed — removing from local DB anyway");
    }

    await prisma.subscription.delete({ where: { id: subId } });

    res.json(DeleteSubscriptionResponse.parse({ ok: true }));
  } catch (err: unknown) {
    req.log?.error?.({ err }, "Failed to delete subscription");
    res.status(500).json({ error: "Ошибка удаления подписки" });
  }
});



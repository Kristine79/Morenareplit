import { Router, type IRouter, type Request, type Response } from "express";
import axios from "axios";
import Database from "better-sqlite3";
import path from "node:path";
import {
  GetResellerProfileResponse,
  CreateResellerClientBody,
  CreateResellerClientResponse,
  RenewSubscriptionBody,
  RenewSubscriptionResponse,
  DeleteSubscriptionResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ROYALTYKEY_BASE = "https://royaltykey.com/api/v1";

const _dbPool = new Map<string, InstanceType<typeof Database>>();

function getWorkspaceRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith(path.join("artifacts", "api-server"))) {
    return path.resolve(cwd, "../..");
  }
  return cwd;
}

function openDb(): InstanceType<typeof Database> {
  const dbPath = path.resolve(
    getWorkspaceRoot(),
    "artifacts/morena-vpn-bot/prisma/morena.db"
  );
  if (_dbPool.has(dbPath)) {
    return _dbPool.get(dbPath)!;
  }
  const db = new Database(dbPath, { readonly: false });
  db.pragma("journal_mode = WAL");
  _dbPool.set(dbPath, db);
  return db;
}

function getApiHeaders() {
  const token = process.env.ROYALTYKEY_API_KEY;
  if (!token) throw new Error("ROYALTYKEY_API_KEY не задан");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function closeDb(): void {
  const dbPath = path.resolve(
    getWorkspaceRoot(),
    "artifacts/morena-vpn-bot/prisma/morena.db"
  );
  const db = _dbPool.get(dbPath);
  if (db) {
    db.close();
    _dbPool.delete(dbPath);
  }
}

router.get("/admin/reseller/profile", async (req: Request, res: Response): Promise<void> => {
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
    req.log.error({ err }, "RoyaltyKey getProfile failed");
    res.status(502).json({ error: "Ошибка запроса к RoyaltyKey API" });
  }
});

router.post("/admin/reseller/clients", async (req: Request, res: Response): Promise<void> => {
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
    req.log.error({ err }, "RoyaltyKey createUser failed");
    res.status(502).json({ error: "Ошибка создания клиента в RoyaltyKey API" });
  }
});

router.post("/admin/subscriptions/:id/renew", async (req: Request, res: Response): Promise<void> => {
  const subId = req.params.id as string;
  const parsed = RenewSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { tariffId } = parsed.data;

  const db = openDb();
  try {
    const sub = db.prepare("SELECT id FROM Subscription WHERE id = ?").get(subId) as { id: string } | undefined;
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

    db.prepare("UPDATE Subscription SET expiresAt = ?, tariffId = ? WHERE id = ?")
      .run(user.expires_at, user.tariff_id, subId);

    res.json(RenewSubscriptionResponse.parse({
      id: user.id,
      vpnKey: user.vpn_key,
      expiresAt: user.expires_at,
      tariffId: user.tariff_id,
    }));
  } catch (err: unknown) {
    req.log.error({ err }, "RoyaltyKey renewSubscription failed");
    res.status(502).json({ error: "Ошибка продления в RoyaltyKey API" });
  } finally {
    const dbPath = path.resolve(
      getWorkspaceRoot(),
      "artifacts/morena-vpn-bot/prisma/morena.db"
    );
    if (!_dbPool.has(dbPath)) {
      db.close();
    }
  }
});

router.delete("/admin/subscriptions/:id", async (req: Request, res: Response): Promise<void> => {
  const subId = req.params.id as string;

  const db = openDb();
  try {
    const sub = db.prepare("SELECT id FROM Subscription WHERE id = ?").get(subId) as { id: string } | undefined;
    if (!sub) {
      res.status(404).json({ error: "Подписка не найдена" });
      return;
    }

    try {
      await axios.delete(`${ROYALTYKEY_BASE}/users/${subId}`, {
        headers: getApiHeaders(),
      });
    } catch (err: unknown) {
      req.log.warn({ err }, "RoyaltyKey deleteUser failed — removing from local DB anyway");
    }

    db.prepare("DELETE FROM Subscription WHERE id = ?").run(subId);

    res.json(DeleteSubscriptionResponse.parse({ ok: true }));
  } finally {
    const dbPath = path.resolve(
      getWorkspaceRoot(),
      "artifacts/morena-vpn-bot/prisma/morena.db"
    );
    if (!_dbPool.has(dbPath)) {
      db.close();
    }
  }
});

export default router;

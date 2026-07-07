import { Router, type IRouter, type Request, type Response } from "express";
import Database from "better-sqlite3";
import path from "node:path";
import {
  GetAdminStatsResponse,
  ListAdminUsersResponse,
  ListAdminUsersQueryParams,
  ListAdminPaymentsResponse,
  ListAdminPaymentsQueryParams,
  ListAdminSubscriptionsResponse,
  ListAdminSubscriptionsQueryParams,
  ListAdminPromocodesResponse,
  CreateAdminPromocodeResponse,
  CreateAdminPromocodeBody,
  AdjustUserBalanceResponse,
  AdjustUserBalanceBody,
  AdjustUserBalanceParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function getWorkspaceRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith(path.join("artifacts", "api-server"))) {
    return path.resolve(cwd, "../..");
  }
  return cwd;
}

const _dbPool = new Map<string, InstanceType<typeof Database>>();

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

router.get("/admin/stats", async (_req: Request, res: Response): Promise<void> => {
  const db = openDb();
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const totalUsers = (db.prepare("SELECT COUNT(*) as n FROM User").get() as { n: number }).n;
    const trialUsers = (db.prepare("SELECT COUNT(*) as n FROM User WHERE hasUsedTrial = 1").get() as { n: number }).n;
    const totalRevenue = (db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM Payment WHERE status = 'paid'").get() as { s: number }).s;
    const revenueToday = (db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM Payment WHERE status = 'paid' AND createdAt >= ?").get(todayStart) as { s: number })?.s ?? 0;
    const newUsersToday = (db.prepare("SELECT COUNT(*) as n FROM User WHERE lastActivityAt >= ?").get(todayStart) as { n: number })?.n ?? 0;

    const activeSubscriptions = (
      db.prepare("SELECT COUNT(*) as n FROM Subscription WHERE expiresAt > ?").get(now.toISOString()) as { n: number }
    ).n;
    const expiredSubscriptions = (
      db.prepare("SELECT COUNT(*) as n FROM Subscription WHERE expiresAt <= ?").get(now.toISOString()) as { n: number }
    ).n;
    const pendingPayments = (db.prepare("SELECT COUNT(*) as n FROM Payment WHERE status = 'pending'").get() as { n: number }).n;
    const paidPayments = (db.prepare("SELECT COUNT(*) as n FROM Payment WHERE status = 'paid'").get() as { n: number }).n;

    const activeToday = (
      db.prepare("SELECT COUNT(*) as n FROM User WHERE lastActivityAt >= ?").get(todayStart) as { n: number }
    ).n;
    const activeWeek = (
      db.prepare("SELECT COUNT(*) as n FROM User WHERE lastActivityAt >= ?").get(weekAgo) as { n: number }
    ).n;
    const activeMonth = (
      db.prepare("SELECT COUNT(*) as n FROM User WHERE lastActivityAt >= ?").get(monthAgo) as { n: number }
    ).n;

    const recentPaymentsRaw = db.prepare(`
      SELECT p.id, p.telegramUserId, u.username, p.tariffId, p.amount, p.status
      FROM Payment p
      LEFT JOIN User u ON u.id = p.telegramUserId
      ORDER BY p.rowid DESC
      LIMIT 10
    `).all() as Array<{
      id: string; telegramUserId: bigint | string; username: string | null;
      tariffId: string; amount: number; status: string;
    }>;

    const recentPayments = recentPaymentsRaw.map((r) => ({
      id: r.id,
      telegramUserId: r.telegramUserId.toString(),
      username: r.username ?? null,
      tariffId: r.tariffId,
      amount: r.amount,
      status: r.status,
    }));

    res.json(GetAdminStatsResponse.parse({
      totalUsers,
      totalRevenue,
      activeSubscriptions,
      expiredSubscriptions,
      trialUsers,
      pendingPayments,
      paidPayments,
      revenueToday,
      newUsersToday,
      activeToday,
      activeWeek,
      activeMonth,
      recentPayments,
    }));
  } finally {
    if (!_dbPool.has(path.resolve(getWorkspaceRoot(), "artifacts/morena-vpn-bot/prisma/morena.db"))) {
      db.close();
    }
  }
});

router.get("/admin/users", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListAdminUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 20, search } = parsed.data;
  const cappedLimit = Math.min(limit, 100);
  const offset = (page - 1) * cappedLimit;

  const db = openDb();
  try {
    let where = "";
    const params: unknown[] = [];
    if (search) {
      where = "WHERE u.username LIKE ? OR CAST(u.id AS TEXT) LIKE ?";
      params.push(`%${search}%`, `%${search}%`);
    }

    const total = (
      db.prepare(`SELECT COUNT(*) as n FROM User u ${where}`).get(...params) as { n: number }
    ).n;

    const users = db.prepare(`
      SELECT u.id, u.username, u.balance, u.hasUsedTrial, u.referredById, u.lastActivityAt,
             COUNT(s.id) as subscriptionCount
      FROM User u
      LEFT JOIN Subscription s ON s.telegramUserId = u.id
      ${where}
      GROUP BY u.id
      ORDER BY u.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, cappedLimit, offset) as Array<{
      id: bigint | string; username: string | null; balance: number;
      hasUsedTrial: number; referredById: bigint | string | null;
      lastActivityAt: string | null; subscriptionCount: number;
    }>;

    res.json(ListAdminUsersResponse.parse({
      items: users.map((u) => ({
        id: u.id.toString(),
        username: u.username ?? null,
        balance: u.balance,
        hasUsedTrial: u.hasUsedTrial === 1,
        referredById: u.referredById ? u.referredById.toString() : null,
        subscriptionCount: u.subscriptionCount,
        lastActivityAt: u.lastActivityAt ?? null,
      })),
      total,
      page,
      limit: cappedLimit,
    }));
  } finally {
    if (!_dbPool.has(path.resolve(getWorkspaceRoot(), "artifacts/morena-vpn-bot/prisma/morena.db"))) {
      db.close();
    }
  }
});

router.get("/admin/payments", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListAdminPaymentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 20, status } = parsed.data;
  const cappedLimit = Math.min(limit, 100);
  const offset = (page - 1) * cappedLimit;

  const db = openDb();
  try {
    let where = "";
    const params: unknown[] = [];
    if (status) {
      where = "WHERE p.status = ?";
      params.push(status);
    }

    const total = (
      db.prepare(`SELECT COUNT(*) as n FROM Payment p ${where}`).get(...params) as { n: number }
    ).n;

    const payments = db.prepare(`
      SELECT p.id, p.telegramUserId, u.username, p.tariffId, p.amount, p.status
      FROM Payment p
      LEFT JOIN User u ON u.id = p.telegramUserId
      ${where}
      ORDER BY p.rowid DESC
      LIMIT ? OFFSET ?
    `).all(...params, cappedLimit, offset) as Array<{
      id: string; telegramUserId: bigint | string; username: string | null;
      tariffId: string; amount: number; status: string;
    }>;

    res.json(ListAdminPaymentsResponse.parse({
      items: payments.map((p) => ({
        id: p.id,
        telegramUserId: p.telegramUserId.toString(),
        username: p.username ?? null,
        tariffId: p.tariffId,
        amount: p.amount,
        status: p.status,
      })),
      total,
      page,
      limit: cappedLimit,
    }));
  } finally {
    if (!_dbPool.has(path.resolve(getWorkspaceRoot(), "artifacts/morena-vpn-bot/prisma/morena.db"))) {
      db.close();
    }
  }
});

router.get("/admin/subscriptions", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListAdminSubscriptionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 20, active } = parsed.data;
  const cappedLimit = Math.min(limit, 100);
  const offset = (page - 1) * cappedLimit;
  const now = new Date().toISOString();

  const db = openDb();
  try {
    let where = "";
    const params: unknown[] = [];
    if (active === true) {
      where = "WHERE s.expiresAt > ?";
      params.push(now);
    } else if (active === false) {
      where = "WHERE s.expiresAt <= ?";
      params.push(now);
    }

    const total = (
      db.prepare(`SELECT COUNT(*) as n FROM Subscription s ${where}`).get(...params) as { n: number }
    ).n;

    const subs = db.prepare(`
      SELECT s.id, s.telegramUserId, u.username, s.vpnKey, s.tariffId, s.expiresAt
      FROM Subscription s
      LEFT JOIN User u ON u.id = s.telegramUserId
      ${where}
      ORDER BY s.expiresAt DESC
      LIMIT ? OFFSET ?
    `).all(...params, cappedLimit, offset) as Array<{
      id: string; telegramUserId: bigint | string; username: string | null;
      vpnKey: string; tariffId: string; expiresAt: string;
    }>;

    res.json(ListAdminSubscriptionsResponse.parse({
      items: subs.map((s) => ({
        id: s.id,
        telegramUserId: s.telegramUserId.toString(),
        username: s.username ?? null,
        vpnKey: s.vpnKey,
        tariffId: s.tariffId,
        expiresAt: String(s.expiresAt),
        isActive: new Date(s.expiresAt).getTime() > Date.now(),
      })),
      total,
      page,
      limit: cappedLimit,
    }));
  } finally {
    if (!_dbPool.has(path.resolve(getWorkspaceRoot(), "artifacts/morena-vpn-bot/prisma/morena.db"))) {
      db.close();
    }
  }
});

router.get("/admin/promocodes", async (_req: Request, res: Response): Promise<void> => {
  const db = openDb();
  try {
    const promos = db.prepare("SELECT id, bonusAmount, maxUses, usesCount FROM Promocode ORDER BY rowid DESC").all() as Array<{
      id: string; bonusAmount: number; maxUses: number; usesCount: number;
    }>;
    res.json(ListAdminPromocodesResponse.parse(promos));
  } finally {
    if (!_dbPool.has(path.resolve(getWorkspaceRoot(), "artifacts/morena-vpn-bot/prisma/morena.db"))) {
      db.close();
    }
  }
});

router.post("/admin/promocodes", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateAdminPromocodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { id, bonusAmount, maxUses } = parsed.data;

  if (bonusAmount < 1 || bonusAmount > 100000) {
    res.status(400).json({ error: "bonusAmount должен быть от 1 до 100000" });
    return;
  }
  if (maxUses < 1 || maxUses > 100000) {
    res.status(400).json({ error: "maxUses должен быть от 1 до 100000" });
    return;
  }

  const db = openDb();
  try {
    db.prepare(`
      INSERT INTO Promocode (id, bonusAmount, maxUses, usesCount)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET bonusAmount = excluded.bonusAmount, maxUses = excluded.maxUses
    `).run(id.toUpperCase(), bonusAmount, maxUses);

    const promo = db.prepare("SELECT id, bonusAmount, maxUses, usesCount FROM Promocode WHERE id = ?").get(id.toUpperCase()) as {
      id: string; bonusAmount: number; maxUses: number; usesCount: number;
    };

    res.status(201).json(CreateAdminPromocodeResponse.parse(promo));
  } finally {
    if (!_dbPool.has(path.resolve(getWorkspaceRoot(), "artifacts/morena-vpn-bot/prisma/morena.db"))) {
      db.close();
    }
  }
});

router.patch("/admin/users/:userId/balance", async (req: Request, res: Response): Promise<void> => {
  const rawId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const paramsRes = AdjustUserBalanceParams.safeParse({ userId: rawId });
  if (!paramsRes.success) {
    res.status(400).json({ error: paramsRes.error.message });
    return;
  }

  const bodyRes = AdjustUserBalanceBody.safeParse(req.body);
  if (!bodyRes.success) {
    res.status(400).json({ error: bodyRes.error.message });
    return;
  }

  const { userId } = paramsRes.data;
  const { delta } = bodyRes.data;

  if (delta < -100000 || delta > 100000) {
    res.status(400).json({ error: "delta должен быть от -100000 до 100000" });
    return;
  }

  const db = openDb();
  try {
    const user = db.prepare("SELECT id, balance FROM User WHERE id = ?").get(userId) as { id: bigint | string; balance: number } | undefined;
    if (!user) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }

    const newBalance = user.balance + delta;
    if (newBalance < 0) {
      res.status(400).json({ error: "Баланс не может быть отрицательным" });
      return;
    }

    if (delta !== 0) {
      logger.info(
        { adminId: req.session.userId, targetUserId: userId, delta, oldBalance: user.balance, newBalance },
        "Balance adjustment"
      );
    }

    db.prepare("UPDATE User SET balance = balance + ? WHERE id = ?").run(delta, userId);

    const updated = db.prepare(`
      SELECT u.id, u.username, u.balance, u.hasUsedTrial, u.referredById,
             COUNT(s.id) as subscriptionCount
      FROM User u
      LEFT JOIN Subscription s ON s.telegramUserId = u.id
      WHERE u.id = ?
      GROUP BY u.id
    `).get(userId) as {
      id: bigint | string; username: string | null; balance: number;
      hasUsedTrial: number; referredById: bigint | string | null; subscriptionCount: number;
    };

    res.json(AdjustUserBalanceResponse.parse({
      id: updated.id.toString(),
      username: updated.username ?? null,
      balance: updated.balance,
      hasUsedTrial: updated.hasUsedTrial === 1,
      referredById: updated.referredById ? updated.referredById.toString() : null,
      subscriptionCount: updated.subscriptionCount,
    }));
  } finally {
    if (!_dbPool.has(path.resolve(getWorkspaceRoot(), "artifacts/morena-vpn-bot/prisma/morena.db"))) {
      db.close();
    }
  }
});

export default router;

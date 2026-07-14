import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../middleware/jwt.js";
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
} from "@workspace/api-zod";
import { prisma } from "../../../lib/prisma.js";
import { logger } from "../lib/logger.js";

export const adminRouter = Router();

adminRouter.use("/admin", requireAuth);

adminRouter.get("/admin/stats", async (_req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalUsers, trialUsers, totalRevenueAgg, pendingPayments, paidPayments,
      activeSubscriptions, expiredSubscriptions, activeToday, activeWeek, activeMonth,
      revenueToday, newUsersToday, recentPayments] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { hasUsedTrial: true } }),
      prisma.payment.aggregate({ where: { status: "paid" }, _sum: { amount: true } }),
      prisma.payment.count({ where: { status: "pending" } }),
      prisma.payment.count({ where: { status: "paid" } }),
      prisma.subscription.count({ where: { expiresAt: { gt: now } } }),
      prisma.subscription.count({ where: { expiresAt: { lte: now } } }),
      prisma.user.count({ where: { lastActivityAt: { gte: todayStart } } }),
      prisma.user.count({ where: { lastActivityAt: { gte: weekAgo } } }),
      prisma.user.count({ where: { lastActivityAt: { gte: monthAgo } } }),
      prisma.payment.aggregate({
        where: { status: "paid", createdAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
      prisma.user.count({ where: { lastActivityAt: { gte: todayStart } } }),
      prisma.payment.findMany({
        where: { status: "paid" },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { user: { select: { username: true } } },
      }),
    ]);

    res.json(GetAdminStatsResponse.parse({
      totalUsers,
      totalRevenue: totalRevenueAgg._sum.amount ?? 0,
      activeSubscriptions,
      expiredSubscriptions,
      trialUsers,
      pendingPayments,
      paidPayments,
      revenueToday: revenueToday._sum.amount ?? 0,
      newUsersToday,
      activeToday,
      activeWeek,
      activeMonth,
      recentPayments: recentPayments.map((p) => ({
        id: p.id,
        telegramUserId: p.telegramUserId.toString(),
        username: p.user?.username ?? null,
        tariffId: p.tariffId,
        amount: p.amount,
        status: p.status,
      })),
    }));
  } catch (err) {
    logger.error({ err }, "Failed to get admin stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

adminRouter.get("/admin/users", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListAdminUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 20, search } = parsed.data;
  const cappedLimit = Math.min(limit, 100);
  const offset = (page - 1) * cappedLimit;

  try {
    const where = search
      ? {
          OR: [
            { username: { contains: search } },
            { id: { equals: isNaN(Number(search)) ? undefined : BigInt(search) } },
          ].filter((c) => c.id !== undefined || c.username !== undefined),
        }
      : {};

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { id: "desc" },
        take: cappedLimit,
        skip: offset,
        include: {
          _count: { select: { subscriptions: true } },
        },
      }),
    ]);

    res.json(ListAdminUsersResponse.parse({
      items: users.map((u) => ({
        id: u.id.toString(),
        username: u.username ?? null,
        balance: u.balance,
        hasUsedTrial: u.hasUsedTrial,
        referredById: u.referredById ? u.referredById.toString() : null,
        subscriptionCount: u._count.subscriptions,
        lastActivityAt: u.lastActivityAt?.toISOString() ?? null,
      })),
      total,
      page,
      limit: cappedLimit,
    }));
  } catch (err) {
    logger.error({ err }, "Failed to list admin users");
    res.status(500).json({ error: "Internal server error" });
  }
});

adminRouter.get("/admin/payments", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListAdminPaymentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 20, status } = parsed.data;
  const cappedLimit = Math.min(limit, 100);
  const offset = (page - 1) * cappedLimit;

  try {
    const where = status ? { status } : {};

    const [total, payments] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: cappedLimit,
        skip: offset,
        include: { user: { select: { username: true } } },
      }),
    ]);

    res.json(ListAdminPaymentsResponse.parse({
      items: payments.map((p) => ({
        id: p.id,
        telegramUserId: p.telegramUserId.toString(),
        username: p.user?.username ?? null,
        tariffId: p.tariffId,
        amount: p.amount,
        status: p.status,
      })),
      total,
      page,
      limit: cappedLimit,
    }));
  } catch (err) {
    logger.error({ err }, "Failed to list admin payments");
    res.status(500).json({ error: "Internal server error" });
  }
});

adminRouter.get("/admin/subscriptions", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListAdminSubscriptionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page = 1, limit = 20, active } = parsed.data;
  const cappedLimit = Math.min(limit, 100);
  const offset = (page - 1) * cappedLimit;
  const now = new Date();

  try {
    let where: Record<string, unknown> = {};
    if (active === true) {
      where = { expiresAt: { gt: now } };
    } else if (active === false) {
      where = { expiresAt: { lte: now } };
    }

    const [total, subs] = await Promise.all([
      prisma.subscription.count({ where }),
      prisma.subscription.findMany({
        where,
        orderBy: { expiresAt: "desc" },
        take: cappedLimit,
        skip: offset,
        include: { user: { select: { username: true } } },
      }),
    ]);

    res.json(ListAdminSubscriptionsResponse.parse({
      items: subs.map((s) => ({
        id: s.id,
        telegramUserId: s.telegramUserId.toString(),
        username: s.user?.username ?? null,
        vpnKey: s.vpnKey,
        tariffId: s.tariffId,
        expiresAt: s.expiresAt.toISOString(),
        isActive: s.expiresAt.getTime() > Date.now(),
      })),
      total,
      page,
      limit: cappedLimit,
    }));
  } catch (err) {
    logger.error({ err }, "Failed to list admin subscriptions");
    res.status(500).json({ error: "Internal server error" });
  }
});

adminRouter.get("/admin/promocodes", async (_req: Request, res: Response): Promise<void> => {
  try {
    const promos = await prisma.promocode.findMany({
      orderBy: { id: "desc" },
    });
    res.json(ListAdminPromocodesResponse.parse(promos));
  } catch (err) {
    logger.error({ err }, "Failed to list promocodes");
    res.status(500).json({ error: "Internal server error" });
  }
});

adminRouter.post("/admin/promocodes", async (req: Request, res: Response): Promise<void> => {
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

  try {
    const promo = await prisma.promocode.upsert({
      where: { id: id.toUpperCase() },
      update: { bonusAmount, maxUses },
      create: { id: id.toUpperCase(), bonusAmount, maxUses },
    });

    res.status(201).json(CreateAdminPromocodeResponse.parse(promo));
  } catch (err) {
    logger.error({ err }, "Failed to create promocode");
    res.status(500).json({ error: "Internal server error" });
  }
});

adminRouter.patch("/admin/users/:userId/balance", async (req: Request, res: Response): Promise<void> => {
  const rawId = req.params.userId as string;
  const userId = BigInt(rawId);

  const bodyRes = AdjustUserBalanceBody.safeParse(req.body);
  if (!bodyRes.success) {
    res.status(400).json({ error: bodyRes.error.message });
    return;
  }

  const { delta } = bodyRes.data;

  if (delta < -100000 || delta > 100000) {
    res.status(400).json({ error: "delta должен быть от -100000 до 100000" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
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
        { adminId: req.user?.userId, targetUserId: rawId, delta, oldBalance: user.balance, newBalance },
        "Balance adjustment"
      );
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { balance: { increment: delta } },
      include: {
        _count: { select: { subscriptions: true } },
      },
    });

    res.json(AdjustUserBalanceResponse.parse({
      id: updated.id.toString(),
      username: updated.username ?? null,
      balance: updated.balance,
      hasUsedTrial: updated.hasUsedTrial,
      referredById: updated.referredById ? updated.referredById.toString() : null,
      subscriptionCount: updated._count.subscriptions,
    }));
  } catch (err) {
    logger.error({ err }, "Failed to adjust user balance");
    res.status(500).json({ error: "Internal server error" });
  }
});



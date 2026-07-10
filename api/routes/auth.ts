import { Router } from "express";
import type { Request, Response } from "express";
import crypto from "node:crypto";
import {
  GetAuthConfigResponse,
  GetAuthMeResponse,
  LogoutResponse,
} from "@workspace/api-zod";
import { authRateLimiter } from "../middleware/rateLimit.js";
import { signToken, COOKIE_NAME } from "../middleware/jwt.js";

const router = Router();

router.get("/auth/config", (_req: Request, res: Response): void => {
  const botUsername = process.env.BOT_USERNAME ?? "morenavpn_bot";
  res.json(GetAuthConfigResponse.parse({ botUsername }));
});

router.post("/auth/login", authRateLimiter, (req: Request, res: Response): void => {
  const { password } = req.body as { password?: string };
  if (!password) {
    res.status(400).json({ error: "Пароль не указан" });
    return;
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(500).json({ error: "Сервер не настроен" });
    return;
  }

  if (password !== adminPassword) {
    res.status(403).json({ error: "Неверный пароль" });
    return;
  }

  const token = signToken({ userId: 1, firstName: "Admin" });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  res.json({ id: 1, firstName: "Admin" });
});

router.get("/auth/me", (req: Request, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }

  res.json(GetAuthMeResponse.parse({
    id: req.user.userId,
    firstName: req.user.firstName ?? "Admin",
    username: req.user.username,
  }));
});

router.post("/auth/logout", (req: Request, res: Response): void => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json(LogoutResponse.parse({ ok: true }));
});

export default router;

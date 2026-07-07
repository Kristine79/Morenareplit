import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import {
  GetAuthConfigResponse,
  TelegramLoginBody,
  TelegramLoginResponse,
  GetAuthMeResponse,
  LogoutResponse,
} from "@workspace/api-zod";
import { authRateLimiter } from "../middleware/rateLimit";
import "../types/session.d.ts";

const router: IRouter = Router();

function verifyTelegramHash(data: Record<string, string>, botToken: string): boolean {
  const { hash, ...rest } = data;
  if (!hash) return false;

  const checkString = Object.entries(rest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");

  if (typeof crypto.timingSafeEqual === "function") {
    const buf1 = Buffer.from(expectedHash);
    const buf2 = Buffer.from(hash);
    if (buf1.length !== buf2.length) return false;
    return crypto.timingSafeEqual(buf1, buf2);
  }

  return expectedHash === hash;
}

router.get("/auth/config", (_req: Request, res: Response): void => {
  const botUsername = process.env.BOT_USERNAME ?? "morenavpn_bot";
  res.json(GetAuthConfigResponse.parse({ botUsername }));
});

router.post("/auth/login", authRateLimiter, (req: Request, res: Response): void => {
  const parsed = TelegramLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Неверные данные" });
    return;
  }

  const authData = parsed.data;

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) { res.status(500).json({ error: "Сервер не настроен" }); return; }

  const adminIdStr = process.env.ADMIN_TELEGRAM_ID;
  if (!adminIdStr) { res.status(500).json({ error: "Сервер не настроен" }); return; }
  const adminId = Number(adminIdStr);

  const dataForVerify: Record<string, string> = {};
  for (const [k, v] of Object.entries(authData)) {
    if (v !== undefined && v !== null) {
      dataForVerify[k] = String(v);
    }
  }

  if (!verifyTelegramHash(dataForVerify, botToken)) {
    res.status(401).json({ error: "Неверная подпись данных Telegram" });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - authData.auth_date > 86400) {
    res.status(401).json({ error: "Данные авторизации устарели" });
    return;
  }

  if (authData.id !== adminId) {
    res.status(403).json({ error: "Доступ запрещён" });
    return;
  }

  req.session.userId = authData.id;
  req.session.firstName = authData.first_name ?? "Admin";
  req.session.username = authData.username;

  res.json(TelegramLoginResponse.parse({
    id: authData.id,
    firstName: authData.first_name ?? "Admin",
    username: authData.username,
    lastName: authData.last_name,
  }));
});

router.get("/auth/me", (req: Request, res: Response): void => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }

  res.json(GetAuthMeResponse.parse({
    id: req.session.userId,
    firstName: req.session.firstName ?? "Admin",
    username: req.session.username,
  }));
});

router.post("/auth/password-login", (req: Request, res: Response): void => {
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

  req.session.userId = 1;
  req.session.firstName = "Admin";
  req.session.username = undefined;

  res.json(TelegramLoginResponse.parse({ id: 1, firstName: "Admin" }));
});

router.post("/auth/dev-login", (req: Request, res: Response): void => {
  const { id } = req.body as { id?: number };
  if (!id) {
    res.status(400).json({ error: "ID не указан" });
    return;
  }

  const adminIdStr = process.env.ADMIN_TELEGRAM_ID;
  if (adminIdStr) {
    const adminId = Number(adminIdStr);
    if (id !== adminId) {
      res.status(403).json({ error: "Доступ запрещён" });
      return;
    }
  }

  req.session.userId = id;
  req.session.firstName = "Admin";
  req.session.username = undefined;

  res.json(TelegramLoginResponse.parse({ id, firstName: "Admin" }));
});

router.post("/auth/logout", (req: Request, res: Response): void => {
  req.session.destroy(() => {
    res.clearCookie("morena_admin_sid");
    res.json(LogoutResponse.parse({ ok: true }));
  });
});

export default router;

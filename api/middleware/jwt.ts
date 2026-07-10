import jwt from "jsonwebtoken";
import type { Request, Response } from "express";

export interface JwtUserPayload {
  userId: number;
  firstName: string;
  username?: string;
}

const COOKIE_NAME = "morena_token";

declare global {
  namespace Express {
    interface Request {
      user?: JwtUserPayload;
    }
  }
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return secret;
}

export function jwtMiddleware(req: Request, _res: Response, next: (err?: unknown) => void): void {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!token) {
    next();
    return;
  }
  try {
    const decoded = jwt.verify(token, getSecret()) as JwtUserPayload;
    req.user = decoded;
  } catch {
    // Token invalid or expired — continue as unauthenticated
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: (err?: unknown) => void): void {
  if (!req.user) {
    res.status(401).json({ error: "Требуется авторизация" });
    return;
  }
  next();
}

export function signToken(payload: JwtUserPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "7d" });
}

export { COOKIE_NAME };

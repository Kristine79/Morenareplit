import { type Request, type Response, type NextFunction } from "express";
import "../types/session.d.ts";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Требуется авторизация" }));
    return;
  }
  next();
}

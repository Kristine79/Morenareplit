import { type Request, type Response, type NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, CLEANUP_INTERVAL).unref();

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX ?? "200", 10);
const AUTH_MAX = parseInt(process.env.RATE_LIMIT_AUTH_MAX ?? "10", 10);

function createLimiter(max: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      store.set(key, entry);
    }

    entry.count++;

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - entry.count));

    if (entry.count > max) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    next();
  };
}

export const rateLimiter = createLimiter(MAX_REQUESTS);
export const authRateLimiter = createLimiter(AUTH_MAX);

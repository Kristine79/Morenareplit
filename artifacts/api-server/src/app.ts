import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { rateLimiter } from "./middleware/rateLimit";

function findWorkspaceRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith(path.join("artifacts", "api-server"))) return path.resolve(cwd, "../..");
  if (fs.existsSync(path.join(cwd, "pnpm-workspace.yaml"))) return cwd;
  return cwd;
}

const WORKSPACE_ROOT = findWorkspaceRoot();
const ADMIN_PANEL_DIR = path.resolve(WORKSPACE_ROOT, "artifacts/admin-panel/dist/public");

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET не задан в переменных окружения");
}

const isProduction = process.env.NODE_ENV === "production";
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",").filter(Boolean);

const app: Express = express();

app.set("trust proxy", 1);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Powered-By", "");
  res.removeHeader("X-Powered-By");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-eval' https://telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src https://oauth.telegram.org");
  }
  next();
});

app.use("/api", rateLimiter);

app.use(
  pinoHttp({
    logger,
    autoLogging: isProduction ? { ignore: (req) => req.url === "/api/healthz" } : false,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  session({
    name: "morena_admin_sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(cors({
  origin: isProduction ? ALLOWED_ORIGINS : true,
  credentials: true,
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use("/api", router);

// Serve admin panel (only accessible via SSH tunnel or localhost)
if (fs.existsSync(ADMIN_PANEL_DIR)) {
  logger.info("Admin panel found, mounting at /admin/");
  app.use("/admin", express.static(ADMIN_PANEL_DIR));
  app.use("/admin", (req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(ADMIN_PANEL_DIR, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

export default app;

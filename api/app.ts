import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { rateLimiter } from "./middleware/rateLimit.js";
import { jwtMiddleware } from "./middleware/jwt.js";

const app: Express = express();

app.set("trust proxy", 1);

const isProduction = process.env.NODE_ENV === "production";
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",").filter(Boolean);

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

app.use(cors({
  origin: isProduction ? ALLOWED_ORIGINS : true,
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use(jwtMiddleware);

app.use("/api", router);

export default app;

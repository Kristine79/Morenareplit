import { Router, type Request, type Response } from "express";
import { healthRouter } from "./health.js";
import { authRouter } from "./auth.js";
import { adminRouter } from "./admin.js";
import { resellerRouter } from "./reseller.js";
import { plategalRouter } from "./platega.js";
import { webhookRouter } from "./webhooks.js";
import { cronRouter } from "./cron.js";

export const mainRouter = Router();

mainRouter.use(healthRouter);
mainRouter.use(authRouter);
mainRouter.use(plategalRouter);

mainRouter.use(adminRouter);
mainRouter.use(resellerRouter);

mainRouter.use(webhookRouter);
mainRouter.use(cronRouter);

mainRouter.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});
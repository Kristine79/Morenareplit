import { Router, type Request, type Response } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import adminRouter from "./admin.js";
import resellerRouter from "./reseller.js";
import plategalRouter from "./platega.js";

const router = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(plategalRouter);

router.use(adminRouter);
router.use(resellerRouter);

router.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

export default router;

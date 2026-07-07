import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import adminRouter from "./admin";
import resellerRouter from "./reseller";
import botRouter from "./bot";
import { requireAuth } from "../middleware/requireAuth";

const router: IRouter = Router();

// Публичные маршруты
router.use(healthRouter);
router.use(authRouter);
router.use(botRouter);

// Защищённые admin-маршруты — требуют сессии
router.use(requireAuth);
router.use(adminRouter);
router.use(resellerRouter);

export default router;

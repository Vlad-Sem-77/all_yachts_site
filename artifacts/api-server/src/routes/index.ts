import { Router, type IRouter } from "express";
import healthRouter from "./health";
import listingsRouter from "./listings";
import forumRouter from "./forum";

const router: IRouter = Router();

router.use(healthRouter);
router.use(listingsRouter);
router.use(forumRouter);

export default router;

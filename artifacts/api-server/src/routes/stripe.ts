import { Router, type IRouter, type Request, type Response } from "express";
import {
  step1AccessPortalLink,
  step2GetPortalSession,
  type Step1Result,
} from "../stripe";

const router: IRouter = Router();

router.post("/stripe/step1", async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' in request body" });
    return;
  }

  try {
    const result = await step1AccessPortalLink(url);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Step 1 failed");
    res.status(500).json({ error: message });
  }
});

router.post("/stripe/step2", async (req: Request, res: Response) => {
  const step1 = req.body as Step1Result | undefined;

  if (!step1 || !step1.sessionId) {
    res
      .status(400)
      .json({ error: "Request body must be a valid Step 1 result with sessionId" });
    return;
  }

  try {
    const result = await step2GetPortalSession(step1);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Step 2 failed");
    res.status(500).json({ error: message });
  }
});

router.post(
  "/stripe/flow/step1-2",
  async (req: Request, res: Response) => {
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== "string") {
      res
        .status(400)
        .json({ error: "Missing or invalid 'url' in request body" });
      return;
    }

    try {
      const step1 = await step1AccessPortalLink(url);
      const step2 = await step2GetPortalSession(step1);
      res.json({ step1, step2 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "Step 1+2 flow failed");
      res.status(500).json({ error: message });
    }
  },
);

export default router;

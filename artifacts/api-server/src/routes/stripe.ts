import { Router, type IRouter, type Request, type Response } from "express";
import {
  step1AccessPortalLink,
  step2GetPortalSession,
  step3UpdateSubscription,
  type Step1Result,
  type Step2Result,
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

  if (!step1.authorization) {
    res.status(400).json({ error: "Step 1 result is missing authorization token" });
    return;
  }

  if (!step1.stripeAccount) {
    res.status(400).json({ error: "Step 1 result is missing stripeAccount" });
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

router.post("/stripe/step3", async (req: Request, res: Response) => {
  const body = req.body as {
    step1?: Step1Result;
    step2?: Step2Result;
    targetPriceId?: string;
  };

  const { step1, step2, targetPriceId } = body;

  if (!step1 || !step1.authorization) {
    res.status(400).json({ error: "Missing or invalid step1 result (requires authorization)" });
    return;
  }

  if (!step1.stripeAccount) {
    res.status(400).json({ error: "Step 1 result is missing stripeAccount" });
    return;
  }

  if (!step2 || !step2.sessionId || !step2.flow?.subscriptionId) {
    res.status(400).json({ error: "Missing or invalid step2 result (requires sessionId and subscriptionId)" });
    return;
  }

  if (!targetPriceId || typeof targetPriceId !== "string") {
    res.status(400).json({ error: "Missing or invalid 'targetPriceId'" });
    return;
  }

  try {
    const result = await step3UpdateSubscription(step1, step2, targetPriceId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Step 3 failed");
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

router.post(
  "/stripe/flow/full",
  async (req: Request, res: Response) => {
    const { url, targetPriceId } = req.body as {
      url?: string;
      targetPriceId?: string;
    };

    if (!url || typeof url !== "string") {
      res
        .status(400)
        .json({ error: "Missing or invalid 'url' in request body" });
      return;
    }

    if (!targetPriceId || typeof targetPriceId !== "string") {
      res.status(400).json({ error: "Missing or invalid 'targetPriceId'" });
      return;
    }

    try {
      const step1 = await step1AccessPortalLink(url);
      const step2 = await step2GetPortalSession(step1);
      const step3 = await step3UpdateSubscription(step1, step2, targetPriceId);
      res.json({ step1, step2, step3 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "Full flow (step 1+2+3) failed");
      res.status(500).json({ error: message });
    }
  },
);

export default router;

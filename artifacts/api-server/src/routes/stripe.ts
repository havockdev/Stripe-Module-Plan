import { Router, type IRouter, type Request, type Response } from "express";
import { step1AccessPortalLink } from "../stripe";

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

export default router;

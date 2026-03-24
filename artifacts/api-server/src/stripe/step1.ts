import { parse } from "node-html-parser";
import { BROWSER_HEADERS_STEP1 } from "./headers";

export interface Step1Result {
  authorization: string | null;
  stripeAccount: string | null;
  xStripeManageClientRevision: string | null;
  stripeVersion: string | null;
  csrfToken: string | null;
  sessionId: string | null;
  sessionUrl: string | null;
  livemode: boolean | null;
  raw: {
    tinyPreloaded: Record<string, unknown> | null;
    preloaded: Record<string, unknown> | null;
  };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

function parseJsonScript(
  html: ReturnType<typeof parse>,
  id: string,
): Record<string, unknown> | null {
  const el = html.querySelector(`#${id}`);
  if (!el) return null;
  try {
    const decoded = decodeHtmlEntities(el.rawText);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractSessionId(url: string): string | null {
  const match =
    /\/p\/session\/((?:live|test)_[A-Za-z0-9_-]+)/.exec(url) ||
    /\/billing_portal\/sessions\/(bps_[A-Za-z0-9]+)/.exec(url);
  return match ? match[1] : null;
}

function scanForBpsId(html: string): string | null {
  const match = /bps_[A-Za-z0-9]+/.exec(html);
  return match ? match[0] : null;
}

export async function step1AccessPortalLink(url: string): Promise<Step1Result> {
  const response = await fetch(url, {
    method: "GET",
    headers: BROWSER_HEADERS_STEP1,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `Step 1 request failed: ${response.status} ${response.statusText}`,
    );
  }

  const rawHtml = await response.text();
  const html = parse(rawHtml);

  const tinyPreloaded = parseJsonScript(html, "tiny_preloaded_json");
  const preloaded = parseJsonScript(html, "preloaded_json");

  const csrfToken =
    (tinyPreloaded?.csrf_token as string | undefined) ?? null;
  const xStripeManageClientRevision =
    (tinyPreloaded?.current_head as string | undefined) ?? null;
  const stripeVersion =
    (tinyPreloaded?.current_version as string | undefined) ??
    (preloaded?.current_version as string | undefined) ??
    null;

  const merchant = preloaded?.merchant as
    | Record<string, unknown>
    | undefined;
  const stripeAccount =
    (merchant?.id as string | undefined) ??
    (preloaded?.account_id as string | undefined) ??
    null;

  const authorization =
    (preloaded?.session_api_key as string | undefined) ?? null;

  const livemode =
    typeof preloaded?.livemode === "boolean" ? preloaded.livemode : null;

  const finalUrl = response.url || url;

  const bpsSessionId =
    (preloaded?.portal_session_id as string | undefined) ??
    scanForBpsId(rawHtml);

  const sessionId =
    bpsSessionId ??
    extractSessionId(finalUrl) ??
    extractSessionId(url);

  return {
    authorization: authorization ? `Bearer ${authorization}` : null,
    stripeAccount,
    xStripeManageClientRevision,
    stripeVersion,
    csrfToken,
    sessionId,
    sessionUrl: finalUrl,
    livemode,
    raw: {
      tinyPreloaded,
      preloaded,
    },
  };
}

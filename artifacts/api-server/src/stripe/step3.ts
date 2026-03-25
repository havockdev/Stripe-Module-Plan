import { randomUUID } from "crypto";
import type { Step1Result } from "./step1";
import type { Step2Result } from "./step2";

export interface Step3PaymentMethod {
  id: string | null;
  type: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  funding: string | null;
  wallet: string | null;
  networks: string[] | null;
}

export interface Step3Invoice {
  id: string | null;
  status: string | null;
  paymentIntentId: string | null;
  paymentIntentStatus: string | null;
  paymentIntentClientSecret: string | null;
}

export interface Step3Result {
  subscriptionId: string | null;
  status: string | null;
  pendingUpdate: unknown | null;
  latestInvoice: Step3Invoice | null;
  defaultPaymentMethod: Step3PaymentMethod | null;
  raw: Record<string, unknown>;
}

const STEP3_BASE_URL = "https://billing.stripe.com/v1/billing_portal/sessions";

const EXPAND_PARAMS = ["default_payment_method", "default_source"];

const INCLUDE_ONLY_FIELDS = [
  "id",
  "status",
  "latest_invoice.id",
  "latest_invoice.status",
  "latest_invoice.payment_intent.id",
  "latest_invoice.payment_intent.status",
  "latest_invoice.payment_intent.client_secret",
  "latest_invoice.payment_intent.next_action.boleto_display_details.expires_at",
  "latest_invoice.payment_intent.next_action.boleto_display_details.hosted_voucher_url",
  "latest_invoice.payment_intent.next_action.boleto_display_details.number",
  "latest_invoice.payment_intent.next_action.boleto_display_details.pdf",
  "latest_invoice.payment_intent.next_action.type",
  "pending_update.subscription_items.id",
  "default_payment_method.id",
  "default_payment_method.card.exp_month",
  "default_payment_method.card.exp_year",
  "default_payment_method.card.funding",
  "default_payment_method.card.wallet.type",
  "default_source.id",
  "default_source.exp_year",
  "default_source.exp_month",
  "default_source.funding",
  "default_source.wallet.type",
  "default_source.object",
  "default_source.card.exp_year",
  "default_source.card.exp_month",
  "default_source.type",
  "default_payment_method.acss_debit.bank_name",
  "default_payment_method.acss_debit.last4",
  "default_payment_method.au_becs_debit.last4",
  "default_payment_method.bacs_debit.last4",
  "default_payment_method.boleto.tax_id",
  "default_payment_method.crypto.last4",
  "default_payment_method.crypto.network",
  "default_payment_method.crypto.token_currency",
  "default_payment_method.crypto.wallet_address",
  "default_payment_method.card.brand",
  "default_payment_method.card.last4",
  "default_payment_method.card.networks.available",
  "default_payment_method.nz_bank_account.bank_name",
  "default_payment_method.nz_bank_account.last4",
  "default_payment_method.object",
  "default_payment_method.sepa_debit.last4",
  "default_payment_method.type",
  "default_payment_method.us_bank_account.bank_name",
  "default_payment_method.us_bank_account.last4",
  "default_payment_method.custom.type",
  "default_payment_method.custom.display_name",
  "default_payment_method.custom.logo_url",
  "default_source.status",
  "default_source.ach_credit_transfer.bank_name",
  "default_source.ach_credit_transfer.account_number",
  "default_source.ach_debit.bank_name",
  "default_source.ach_debit.last4",
  "default_source.acss_debit.bank_name",
  "default_source.acss_debit.last4",
  "default_source.bacs_debit.last4",
  "default_source.au_becs_debit.last4",
  "default_source.bitcoin.address",
  "default_source.card.brand",
  "default_source.card.dynamic_last4",
  "default_source.card.last4",
  "default_source.card_present.brand",
  "default_source.card_present.last4",
  "default_source.chf_credit_transfer.participant_number",
  "default_source.ideal.iban_last4",
  "default_source.interac_present.last4",
  "default_source.sepa_debit.last4",
  "default_source.sofort.iban_last4",
  "default_source.paysecure.dynamic_last4",
  "default_source.paysecure.last4",
  "default_source.three_d_secure.brand",
  "default_source.three_d_secure.dynamic_last4",
  "default_source.three_d_secure.last4",
  "default_source.three_d_secure_2.brand",
  "default_source.three_d_secure_2.dynamic_last4",
  "default_source.three_d_secure_2.last4",
  "default_source.three_d_secure_2_eap.brand",
  "default_source.three_d_secure_2_eap.dynamic_last4",
  "default_source.three_d_secure_2_eap.last4",
  "default_source.brand",
  "default_source.dynamic_last4",
  "default_source.last4",
  "default_source.benefits.issuer",
  "default_source.bank_name",
  "default_source.fingerprint",
  "default_source.inbound_address",
];

function buildStep3Url(sessionId: string, subscriptionId: string): string {
  const params = new URLSearchParams();
  for (const exp of EXPAND_PARAMS) {
    params.append("expand[]", exp);
  }
  for (const field of INCLUDE_ONLY_FIELDS) {
    params.append("include_only[]", field);
  }
  return `${STEP3_BASE_URL}/${sessionId}/subscriptions/${subscriptionId}?${params.toString()}`;
}

function buildStep3Referer(
  sessionUrl: string | null,
  subscriptionId: string,
  targetPriceId: string,
): string {
  if (!sessionUrl) {
    return `https://billing.stripe.com/subscriptions/${subscriptionId}/preview/${targetPriceId}?in_flow=true&quantity=1`;
  }
  const base = sessionUrl.replace(/\/flow$/, "").replace(/\/+$/, "");
  return `${base}/subscriptions/${subscriptionId}/preview/${targetPriceId}?in_flow=true&quantity=1`;
}

function buildStep3Body(
  itemId: string,
  quantity: number,
  targetPriceId: string,
): string {
  const params = new URLSearchParams();
  params.append("recurring_items[0][id]", itemId);
  params.append("recurring_items[0][quantity]", String(quantity));
  params.append("recurring_items[0][price]", targetPriceId);
  return params.toString();
}

function buildStep3Headers(
  step1: Step1Result,
  loadId: string,
  referer: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Host: "billing.stripe.com",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Ch-Ua": '"Chromium";v="145", "Not:A-Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept-Language": "pt-BR",
    "Browser-Language": "pt-BR",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    Origin: "https://billing.stripe.com",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Accept-Encoding": "gzip, deflate, br",
    Priority: "u=1, i",
    Referer: referer,
    // Step2Result não expõe csrfToken; usa-se o token extraído no Step 1 (Burp 003 confirma mesmo valor)
    "X-Stripe-Csrf-Token": step1.csrfToken ?? "fake-deprecated-token",
    "X-Request-Source": `service="customer_portal"; project="customer_portal"; operation="PreviewPageBodyUpdateSubscriptionStateMutation"; component="PreviewPageBody"; load_id="${loadId}"`,
  };

  if (step1.authorization) {
    headers["Authorization"] = step1.authorization;
  }
  if (step1.stripeAccount) {
    headers["Stripe-Account"] = step1.stripeAccount;
  }
  if (step1.xStripeManageClientRevision) {
    headers["X-Stripe-Manage-Client-Revision"] =
      step1.xStripeManageClientRevision;
  }
  if (step1.stripeVersion) {
    headers["Stripe-Version"] = step1.stripeVersion;
  }
  if (step1.livemode !== null) {
    headers["Stripe-Livemode"] = String(step1.livemode);
  }

  return headers;
}

function parsePaymentMethod(
  raw: Record<string, unknown>,
): Step3PaymentMethod | null {
  const pm = raw["default_payment_method"] as
    | Record<string, unknown>
    | undefined
    | null;
  if (!pm) return null;

  const card = pm["card"] as Record<string, unknown> | undefined;
  const networks = card?.["networks"] as Record<string, unknown> | undefined;

  return {
    id: (pm["id"] as string | null) ?? null,
    type: (pm["type"] as string | null) ?? null,
    brand: (card?.["brand"] as string | null) ?? null,
    last4: (card?.["last4"] as string | null) ?? null,
    expMonth: (card?.["exp_month"] as number | null) ?? null,
    expYear: (card?.["exp_year"] as number | null) ?? null,
    funding: (card?.["funding"] as string | null) ?? null,
    wallet: (card?.["wallet"] as Record<string, unknown> | null)?.["type"] as
      | string
      | null ?? null,
    networks: Array.isArray(networks?.["available"])
      ? (networks["available"] as string[])
      : null,
  };
}

function parseInvoice(raw: Record<string, unknown>): Step3Invoice | null {
  const inv = raw["latest_invoice"] as Record<string, unknown> | undefined | null;
  if (!inv) return null;

  const pi = inv["payment_intent"] as Record<string, unknown> | undefined | null;

  return {
    id: (inv["id"] as string | null) ?? null,
    status: (inv["status"] as string | null) ?? null,
    paymentIntentId: (pi?.["id"] as string | null) ?? null,
    paymentIntentStatus: (pi?.["status"] as string | null) ?? null,
    paymentIntentClientSecret:
      (pi?.["client_secret"] as string | null) ?? null,
  };
}

export async function step3UpdateSubscription(
  step1: Step1Result,
  step2: Step2Result,
  targetPriceId: string,
): Promise<Step3Result> {
  const sessionId = step2.sessionId;
  const subscriptionId = step2.flow.subscriptionId;

  if (!sessionId) {
    throw new Error("Step 2 result is missing sessionId");
  }
  if (!subscriptionId) {
    throw new Error("Step 2 result is missing subscriptionId");
  }
  if (!step1.authorization) {
    throw new Error("Step 1 result is missing authorization token");
  }
  if (step2.flow.recurringItems.length === 0) {
    throw new Error("Step 2 result has no recurring items");
  }

  const recurringItem = step2.flow.recurringItems[0];
  const quantity = recurringItem.quantity ?? 1;

  const loadId = randomUUID();
  const referer = buildStep3Referer(step1.sessionUrl, subscriptionId, targetPriceId);
  const url = buildStep3Url(sessionId, subscriptionId);
  const body = buildStep3Body(recurringItem.id, quantity, targetPriceId);
  const headers = buildStep3Headers(step1, loadId, referer);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Step 3 request failed: ${response.status} ${response.statusText} — ${text.slice(0, 300)}`,
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;

  return {
    subscriptionId: (raw["id"] as string | null) ?? null,
    status: (raw["status"] as string | null) ?? null,
    pendingUpdate: raw["pending_update"] ?? null,
    latestInvoice: parseInvoice(raw),
    defaultPaymentMethod: parsePaymentMethod(raw),
    raw,
  };
}

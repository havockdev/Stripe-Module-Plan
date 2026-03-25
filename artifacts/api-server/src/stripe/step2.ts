import { randomUUID } from "crypto";
import type { Step1Result } from "./step1";

export interface Step2Price {
  id: string;
  unitAmount: number;
  unitAmountDecimal: string;
  currency: string;
  interval: string;
  intervalCount: number;
  productId: string;
  productName: string;
  productDescription: string | null;
}

export interface Step2Product {
  productId: string;
  disableQuantities: boolean;
  minQuantity: number | null;
  maxQuantity: number | null;
  prices: Step2Price[];
}

export interface Step2RecurringItem {
  id: string;
  price: string;
  quantity: number | null;
  deleted: boolean | null;
}

export interface Step2Flow {
  type: string | null;
  subscriptionId: string | null;
  currentPriceId: string | null;
  recurringItems: Step2RecurringItem[];
  discounts: unknown[] | null;
  redirectReturnUrl: string | null;
}

export interface Step2Configuration {
  id: string;
  isDefault: boolean;
  livemode: boolean;
  features: {
    subscriptionCancel: {
      enabled: boolean;
      mode: string | null;
      prorationBehavior: string | null;
      cancellationReason: {
        enabled: boolean;
        options: string[];
      };
    };
    subscriptionPause: { enabled: boolean };
    subscriptionUpdate: {
      enabled: boolean;
      defaultAllowedUpdates: string[];
      prorationBehavior: string | null;
    };
    invoiceHistory: { enabled: boolean };
    paymentMethodUpdate: { enabled: boolean };
    customerUpdate: {
      enabled: boolean;
      allowedUpdates: string[];
    };
  };
}

export interface Step2Branding {
  accentColor: string | null;
  brandingColor: string | null;
  businessName: string | null;
  icon: string | null;
  logo: string | null;
  useLogoInsteadOfIcon: boolean;
}

export interface Step2Result {
  sessionId: string | null;
  customerId: string | null;
  livemode: boolean | null;
  countryCode: string | null;
  returnUrl: string | null;
  sessionUrl: string | null;
  flow: Step2Flow;
  availableProducts: Step2Product[];
  configuration: Step2Configuration | null;
  branding: Step2Branding;
  raw: Record<string, unknown>;
}

const STEP2_BASE_URL = "https://billing.stripe.com/v1/billing_portal/sessions";

const EXPAND_PARAMS = [
  "configuration.features.subscription_update.portal_client_products.prices2.currency_options_list",
  "configuration.features.subscription_update.portal_client_products.prices2.tiers",
];

const INCLUDE_ONLY_FIELDS = [
  "id",
  "object",
  "customer",
  "created_from",
  "livemode",
  "return_url",
  "url",
  "accent_color",
  "branding_color",
  "business_name",
  "icon",
  "logo",
  "use_logo_instead_of_icon",
  "site_key",
  "on_behalf_of",
  "application",
  "is_merchant_default_tax_behavior_set",
  "as_of",
  "country_code",
  "has_active_rate_card_subscription",
  "retention_flows_enabled",
  "refund_flows_enabled",
  "legacy_retention_features_active",
  "merchant_timezone",
  "flow.id",
  "flow.type",
  "configuration.active",
  "configuration.object",
  "configuration.id",
  "configuration.is_default",
  "configuration.livemode",
  "flow.subscription_update_confirm.subscription",
  "flow.subscription_update.subscription",
  "flow.subscription_cancel.subscription",
  "flow.cancellation_reason.subscription",
  "flow.after_completion.id",
  "flow.after_completion.type",
  "configuration.login_page.id",
  "configuration.login_page.enabled",
  "configuration.login_page.url",
  "configuration.business_profile.headline",
  "configuration.business_profile.privacy_policy_url",
  "configuration.business_profile.terms_of_service_url",
  "configuration.custom_text.id",
  "configuration.custom_text.subscription_renewal_acknowledgment",
  "configuration.custom_text.subscription_update_acknowledgment",
  "configuration.custom_text.back_link",
  "flow.after_completion.hosted_confirmation.custom_message",
  "flow.after_completion.redirect.return_url",
  "configuration.features.subscription_pause.enabled",
  "configuration.features.payment_method_update.enabled",
  "configuration.features.invoice_history.enabled",
  "configuration.features.customer_update.allowed_updates",
  "configuration.features.customer_update.enabled",
  "configuration.features.subscription_update.default_allowed_updates",
  "configuration.features.subscription_update.enabled",
  "configuration.features.subscription_update.proration_behavior",
  "configuration.features.subscription_cancel.enabled",
  "configuration.features.subscription_cancel.mode",
  "configuration.features.subscription_cancel.proration_behavior",
  "flow.subscription_update_confirm.recurring_items.id",
  "flow.subscription_update_confirm.recurring_items.price",
  "flow.subscription_update_confirm.recurring_items.quantity",
  "flow.subscription_update_confirm.recurring_items.deleted",
  "configuration.features.subscription_update.packaging.packaging_configuration",
  "flow.subscription_update_confirm.discounts.promotion_code.id",
  "flow.subscription_update_confirm.discounts.promotion_code.code",
  "configuration.features.subscription_cancel.cancellation_redirect.enabled",
  "configuration.features.subscription_cancel.cancellation_redirect.url",
  "configuration.features.subscription_cancel.cancellation_reason.enabled",
  "configuration.features.subscription_cancel.cancellation_reason.options",
  "configuration.features.subscription_update.portal_client_products.add_on",
  "configuration.features.subscription_update.portal_client_products.disable_quantities",
  "configuration.features.subscription_update.portal_client_products.min_quantity",
  "configuration.features.subscription_update.portal_client_products.max_quantity",
  "configuration.features.subscription_update.portal_client_products.product",
  "configuration.features.subscription_update.portal_client_products.managed_payments_eligible",
  "flow.subscription_update_confirm.discounts.coupon.id",
  "flow.subscription_update_confirm.discounts.coupon.name",
  "flow.subscription_update_confirm.discounts.coupon.duration",
  "flow.subscription_update_confirm.discounts.coupon.duration_in_months",
  "flow.subscription_update_confirm.discounts.coupon.amount_off",
  "flow.subscription_update_confirm.discounts.coupon.currency",
  "flow.subscription_update_confirm.discounts.coupon.currency_options",
  "flow.subscription_update_confirm.discounts.coupon.percent_off",
  "configuration.features.subscription_update.portal_client_products.prices2",
];

function buildStep2Url(sessionId: string): string {
  const params = new URLSearchParams();
  for (const exp of EXPAND_PARAMS) {
    params.append("expand[]", exp);
  }
  for (const field of INCLUDE_ONLY_FIELDS) {
    params.append("include_only[]", field);
  }
  return `${STEP2_BASE_URL}/${sessionId}?${params.toString()}`;
}

function buildStep2Headers(
  step1: Step1Result,
  loadId: string,
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
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Accept-Encoding": "gzip, deflate, br",
    Priority: "u=1, i",
    "X-Stripe-Csrf-Token": step1.csrfToken ?? "fake-deprecated-token",
    "X-Request-Source": `service="customer_portal"; project="customer_portal"; operation="CustomerPortalContainerRetrieveSessionStateQuery"; component="CustomerPortalContainer"; load_id="${loadId}"`,
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
  if (step1.sessionUrl) {
    headers["Referer"] = step1.sessionUrl;
  }

  return headers;
}

function parseProducts(raw: Record<string, unknown>): Step2Product[] {
  const config = raw["configuration"] as Record<string, unknown> | undefined;
  const features = config?.["features"] as Record<string, unknown> | undefined;
  const subscriptionUpdate = features?.["subscription_update"] as
    | Record<string, unknown>
    | undefined;
  const portalClientProducts = subscriptionUpdate?.[
    "portal_client_products"
  ] as Array<Record<string, unknown>> | undefined;

  if (!Array.isArray(portalClientProducts)) return [];

  return portalClientProducts.map((p) => {
    const prices2 = (p["prices2"] as Array<Record<string, unknown>>) ?? [];
    const prices: Step2Price[] = prices2.map((pr) => {
      const recurring = pr["recurring"] as
        | Record<string, unknown>
        | undefined;
      const product = pr["product"] as Record<string, unknown> | undefined;
      return {
        id: pr["id"] as string,
        unitAmount: (pr["unit_amount"] as number) ?? 0,
        unitAmountDecimal: (pr["unit_amount_decimal"] as string) ?? "0",
        currency: (pr["currency"] as string) ?? "usd",
        interval: (recurring?.["interval"] as string) ?? "month",
        intervalCount: (recurring?.["interval_count"] as number) ?? 1,
        productId: (product?.["id"] as string) ?? String(p["product"]),
        productName: (product?.["name"] as string) ?? "",
        productDescription: (product?.["description"] as string) ?? null,
      };
    });

    return {
      productId: p["product"] as string,
      disableQuantities: Boolean(p["disable_quantities"]),
      minQuantity: (p["min_quantity"] as number | null) ?? null,
      maxQuantity: (p["max_quantity"] as number | null) ?? null,
      prices,
    };
  });
}

function parseConfiguration(
  raw: Record<string, unknown>,
): Step2Configuration | null {
  const config = raw["configuration"] as Record<string, unknown> | undefined;
  if (!config) return null;

  const features = config["features"] as Record<string, unknown> | undefined;
  if (!features) return null;

  const sc = features["subscription_cancel"] as
    | Record<string, unknown>
    | undefined;
  const cr = sc?.["cancellation_reason"] as
    | Record<string, unknown>
    | undefined;
  const sp = features["subscription_pause"] as
    | Record<string, unknown>
    | undefined;
  const su = features["subscription_update"] as
    | Record<string, unknown>
    | undefined;
  const ih = features["invoice_history"] as
    | Record<string, unknown>
    | undefined;
  const pmu = features["payment_method_update"] as
    | Record<string, unknown>
    | undefined;
  const cu = features["customer_update"] as
    | Record<string, unknown>
    | undefined;

  return {
    id: config["id"] as string,
    isDefault: Boolean(config["is_default"]),
    livemode: Boolean(config["livemode"]),
    features: {
      subscriptionCancel: {
        enabled: Boolean(sc?.["enabled"]),
        mode: (sc?.["mode"] as string | null) ?? null,
        prorationBehavior:
          (sc?.["proration_behavior"] as string | null) ?? null,
        cancellationReason: {
          enabled: Boolean(cr?.["enabled"]),
          options: (cr?.["options"] as string[]) ?? [],
        },
      },
      subscriptionPause: {
        enabled: Boolean(sp?.["enabled"]),
      },
      subscriptionUpdate: {
        enabled: Boolean(su?.["enabled"]),
        defaultAllowedUpdates:
          (su?.["default_allowed_updates"] as string[]) ?? [],
        prorationBehavior:
          (su?.["proration_behavior"] as string | null) ?? null,
      },
      invoiceHistory: { enabled: Boolean(ih?.["enabled"]) },
      paymentMethodUpdate: { enabled: Boolean(pmu?.["enabled"]) },
      customerUpdate: {
        enabled: Boolean(cu?.["enabled"]),
        allowedUpdates: (cu?.["allowed_updates"] as string[]) ?? [],
      },
    },
  };
}

function parseFlow(raw: Record<string, unknown>): Step2Flow {
  const flow = raw["flow"] as Record<string, unknown> | undefined;
  if (!flow) {
    return {
      type: null,
      subscriptionId: null,
      currentPriceId: null,
      recurringItems: [],
      discounts: null,
      redirectReturnUrl: null,
    };
  }

  const flowType = (flow["type"] as string) ?? null;

  const suc = flow["subscription_update_confirm"] as
    | Record<string, unknown>
    | undefined;
  const su = flow["subscription_update"] as
    | Record<string, unknown>
    | undefined;
  const sc = flow["subscription_cancel"] as
    | Record<string, unknown>
    | undefined;

  const subscriptionId =
    (suc?.["subscription"] as string | null) ??
    (su?.["subscription"] as string | null) ??
    (sc?.["subscription"] as string | null) ??
    null;

  const rawItems = suc?.["recurring_items"] as
    | Array<Record<string, unknown>>
    | undefined;
  const recurringItems: Step2RecurringItem[] = Array.isArray(rawItems)
    ? rawItems.map((item) => ({
        id: item["id"] as string,
        price: item["price"] as string,
        quantity: (item["quantity"] as number | null) ?? null,
        deleted: (item["deleted"] as boolean | null) ?? null,
      }))
    : [];

  const currentPriceId =
    recurringItems.length > 0 ? recurringItems[0].price : null;

  const discounts =
    (suc?.["discounts"] as unknown[] | null | undefined) ?? null;

  const afterCompletion = flow["after_completion"] as
    | Record<string, unknown>
    | undefined;
  const redirect = afterCompletion?.["redirect"] as
    | Record<string, unknown>
    | undefined;
  const redirectReturnUrl = (redirect?.["return_url"] as string | null) ?? null;

  return {
    type: flowType,
    subscriptionId,
    currentPriceId,
    recurringItems,
    discounts: Array.isArray(discounts) ? discounts : null,
    redirectReturnUrl,
  };
}

export async function step2GetPortalSession(
  step1: Step1Result,
): Promise<Step2Result> {
  if (!step1.sessionId) {
    throw new Error("Step 1 result is missing sessionId");
  }
  if (!step1.authorization) {
    throw new Error("Step 1 result is missing authorization token");
  }

  const loadId = randomUUID();
  const url = buildStep2Url(step1.sessionId);
  const headers = buildStep2Headers(step1, loadId);

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Step 2 request failed: ${response.status} ${response.statusText} — ${body.slice(0, 300)}`,
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;

  const branding: Step2Branding = {
    accentColor: (raw["accent_color"] as string | null) ?? null,
    brandingColor: (raw["branding_color"] as string | null) ?? null,
    businessName: (raw["business_name"] as string | null) ?? null,
    icon: (raw["icon"] as string | null) ?? null,
    logo: (raw["logo"] as string | null) ?? null,
    useLogoInsteadOfIcon: Boolean(raw["use_logo_instead_of_icon"]),
  };

  return {
    sessionId: (raw["id"] as string | null) ?? null,
    customerId: (raw["customer"] as string | null) ?? null,
    livemode: typeof raw["livemode"] === "boolean" ? raw["livemode"] : null,
    countryCode: (raw["country_code"] as string | null) ?? null,
    returnUrl: (raw["return_url"] as string | null) ?? null,
    sessionUrl: (raw["url"] as string | null) ?? null,
    flow: parseFlow(raw),
    availableProducts: parseProducts(raw),
    configuration: parseConfiguration(raw),
    branding,
    raw,
  };
}

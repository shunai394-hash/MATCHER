const STRIPE_API = "https://api.stripe.com/v1";

// https://docs.stripe.com/currencies#zero-decimal
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

/** Converts a major-unit amount (e.g. 1234 JPY, 12.34 USD) into Stripe's integer minor units. */
export function toStripeMinorUnits(amount: number, currency: string) {
  if (!Number.isFinite(amount)) return NaN;
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(amount) : Math.round(amount * 100);
}

function secret() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SERVER_CONFIG_MISSING");
  return key;
}

async function stripeRequest(path: string, params: URLSearchParams, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret()}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers,
    body: params,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "STRIPE_REQUEST_FAILED");
  }
  return data;
}

export async function createManualCaptureCheckout(input: {
  amount: number;
  currency: string;
  purchaseReviewId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const p = new URLSearchParams();
  p.set("mode", "payment");
  p.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
  p.set("line_items[0][price_data][product_data][name]", "MATCHER 自動仕入れ（人間承認待ち）");
  p.set("line_items[0][price_data][unit_amount]", String(input.amount));
  p.set("line_items[0][quantity]", "1");
  p.set("payment_intent_data[capture_method]", "manual");
  p.set("payment_intent_data[metadata][purchase_review_id]", input.purchaseReviewId);
  p.set("metadata[purchase_review_id]", input.purchaseReviewId);
  p.set("success_url", input.successUrl);
  p.set("cancel_url", input.cancelUrl);
  return stripeRequest("/checkout/sessions", p, `purchase-review-${input.purchaseReviewId}`);
}

export async function capturePaymentIntent(paymentIntentId: string) {
  return stripeRequest(`/payment_intents/${encodeURIComponent(paymentIntentId)}/capture`, new URLSearchParams(), `capture-${paymentIntentId}`);
}

export async function cancelPaymentIntent(paymentIntentId: string) {
  return stripeRequest(`/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`, new URLSearchParams(), `cancel-${paymentIntentId}`);
}

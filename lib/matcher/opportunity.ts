import { calculateExpectedProfit, evaluateSellability, type IdentityDecision, type Orderability } from "./gate.ts";

/**
 * Single source of truth for "can this supplier offer be shown as a profitable
 * purchase candidate right now?". Used by the recompute job (which persists
 * profit_snapshot / quality_gate_result) and by the opportunity feed (which
 * re-checks live data before showing anything to a buyer).
 *
 * Unknown values never pass: a missing timestamp, policy, cost or fee blocks.
 */

export type FreshnessType = "PRICE" | "INVENTORY" | "SHIPPING" | "MARKET";

/** Used only when freshness_policy has no MARKET row. Market prices older than this are not trusted. */
export const DEFAULT_MARKET_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type FreshnessPolicy = Map<string, number>;

export type MatchInput = {
  decision: IdentityDecision;
  hardBlock: boolean;
  masterProductId: string | null;
  /** The linked master is ACTIVE and APPROVED (candidate / rejected / inactive masters are never sold). */
  masterSellable: boolean;
  confidence: number;
};

export type SnapshotInput = {
  supplierCost: number | null;
  shippingCost: number | null;
  inventory: number | null;
  shippingConfidence: number | null;
  observedAt: string | null;
};

export type FreshnessInput = {
  priceObservedAt: string | null;
  inventoryObservedAt: string | null;
  shippingObservedAt: string | null;
};

export type MarketInput = {
  salePrice: number | null;
  paymentFee: number | null;
  marketplaceFee: number | null;
  tax: number | null;
  otherCost: number | null;
  currency: string;
  observedAt: string | null;
};

export type OfferEvaluationInput = {
  now: number;
  match: MatchInput | null;
  offer: { orderability: Orderability; currency: string };
  snapshot: SnapshotInput | null;
  freshness: FreshnessInput | null;
  market: MarketInput | null;
  policy: FreshnessPolicy;
};

export type FreshnessCheck = {
  observedAt: string | null;
  ageSeconds: number | null;
  maxAgeSeconds: number | null;
  fresh: boolean;
};

export type OfferEvaluation = {
  status: "SELLABLE" | "BLOCKED";
  reasons: string[];
  checks: Record<string, string>;
  profit: {
    salePrice: number;
    supplierCost: number | null;
    shippingCost: number | null;
    paymentFee: number | null;
    marketplaceFee: number | null;
    tax: number | null;
    otherCost: number | null;
    expectedProfit: number | null;
    complete: boolean;
    missing: string[];
  } | null;
  freshness: Record<"price" | "inventory" | "shipping" | "market", FreshnessCheck>;
};

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** freshness_policy has been deployed with either `data_type` or `metric` as the key column. */
export function buildFreshnessPolicy(rows: Array<Record<string, unknown>>): FreshnessPolicy {
  const policy: FreshnessPolicy = new Map();
  for (const row of rows) {
    const key = String(row.data_type ?? row.metric ?? "").trim().toUpperCase();
    const maxAge = toNumber(row.max_age_seconds);
    if (key && maxAge !== null && maxAge > 0) policy.set(key, maxAge);
  }
  return policy;
}

export function checkFreshness(timestamp: string | null | undefined, type: FreshnessType, policy: FreshnessPolicy, now: number): FreshnessCheck {
  const maxAge = policy.get(type) ?? (type === "MARKET" ? DEFAULT_MARKET_MAX_AGE_SECONDS : null);
  const time = timestamp ? new Date(timestamp).getTime() : NaN;
  if (!Number.isFinite(time)) return { observedAt: timestamp ?? null, ageSeconds: null, maxAgeSeconds: maxAge, fresh: false };
  const ageSeconds = Math.max(0, Math.round((now - time) / 1000));
  // A timestamp from the future is treated as untrustworthy rather than "very fresh".
  const fromFuture = time - now > 5 * 60 * 1000;
  return { observedAt: timestamp ?? null, ageSeconds, maxAgeSeconds: maxAge, fresh: maxAge !== null && !fromFuture && ageSeconds <= maxAge };
}

export function evaluateOffer(input: OfferEvaluationInput): OfferEvaluation {
  const { now, match, offer, snapshot, freshness, market, policy } = input;
  const extra: string[] = [];

  if (!match) extra.push("IDENTITY_NOT_MATCHED");
  else if (match.hardBlock) extra.push("IDENTITY_HARD_BLOCK");
  if (match && !match.masterProductId) extra.push("IDENTITY_MASTER_MISSING");
  else if (match && !match.masterSellable) extra.push("MASTER_NOT_APPROVED");

  for (const type of ["PRICE", "INVENTORY", "SHIPPING"] as const) {
    if (!policy.has(type)) extra.push(`FRESHNESS_POLICY_${type}_MISSING`);
  }

  const freshnessChecks = {
    price: checkFreshness(freshness?.priceObservedAt, "PRICE", policy, now),
    inventory: checkFreshness(freshness?.inventoryObservedAt, "INVENTORY", policy, now),
    shipping: checkFreshness(freshness?.shippingObservedAt, "SHIPPING", policy, now),
    market: checkFreshness(market?.observedAt, "MARKET", policy, now),
  };
  if (!freshness) extra.push("FRESHNESS_RECORD_MISSING");
  if (!freshnessChecks.shipping.fresh) extra.push("SHIPPING_STALE");

  if (!snapshot) extra.push("SUPPLIER_SNAPSHOT_MISSING");
  else if (snapshot.shippingCost !== null && !(snapshot.shippingConfidence !== null && snapshot.shippingConfidence > 0)) {
    extra.push("SHIPPING_UNVERIFIED");
  }

  const offerCurrency = (offer.currency || "").trim().toUpperCase();
  let profit: OfferEvaluation["profit"] = null;
  if (!market || market.salePrice === null) {
    extra.push("MARKET_PRICE_MISSING");
  } else {
    if (!freshnessChecks.market.fresh) extra.push("MARKET_PRICE_STALE");
    if (market.currency.toUpperCase() !== offerCurrency) extra.push("CURRENCY_MISMATCH");
    const calc = calculateExpectedProfit({
      salePrice: market.salePrice,
      supplierCost: snapshot?.supplierCost ?? null,
      shippingCost: snapshot?.shippingCost ?? null,
      paymentFee: market.paymentFee,
      marketplaceFee: market.marketplaceFee,
      tax: market.tax,
      otherCost: market.otherCost,
    });
    profit = {
      salePrice: market.salePrice,
      supplierCost: snapshot?.supplierCost ?? null,
      shippingCost: snapshot?.shippingCost ?? null,
      paymentFee: market.paymentFee,
      marketplaceFee: market.marketplaceFee,
      tax: market.tax,
      otherCost: market.otherCost,
      expectedProfit: calc.expectedProfit === null ? null : Math.round(calc.expectedProfit * 100) / 100,
      complete: calc.complete,
      missing: calc.missing,
    };
  }

  const inventory = snapshot?.inventory ?? null;
  const gate = evaluateSellability({
    identityDecision: match?.decision ?? "REVIEW",
    hardBlockReasons: extra,
    orderability: offer.orderability,
    inventoryKnown: inventory !== null,
    inventoryAvailable: inventory !== null && inventory > 0,
    inventoryFresh: freshnessChecks.inventory.fresh,
    priceKnown: snapshot?.supplierCost != null,
    priceFresh: freshnessChecks.price.fresh,
    supplierCost: snapshot?.supplierCost ?? null,
    shippingCost: snapshot?.shippingCost ?? null,
    requiredFeesKnown: !!market && [market.paymentFee, market.marketplaceFee, market.tax, market.otherCost].every((fee) => fee !== null),
    expectedProfit: profit?.expectedProfit ?? null,
    profitCurrency: profit && !extra.includes("CURRENCY_MISMATCH") ? offerCurrency : null,
  });

  const checks: Record<string, string> = {
    identity: match ? (match.hardBlock ? "HARD_BLOCK" : match.decision) : "NONE",
    orderability: offer.orderability,
    inventory: inventory === null ? "UNKNOWN" : inventory > 0 ? "AVAILABLE" : "OUT_OF_STOCK",
    priceFreshness: freshnessChecks.price.fresh ? "FRESH" : "STALE",
    inventoryFreshness: freshnessChecks.inventory.fresh ? "FRESH" : "STALE",
    shippingFreshness: freshnessChecks.shipping.fresh ? "FRESH" : "STALE",
    marketPrice: !market ? "MISSING" : freshnessChecks.market.fresh ? "FRESH" : "STALE",
    profit: profit?.expectedProfit == null ? "NOT_CALCULABLE" : profit.expectedProfit > 0 ? "POSITIVE" : "NON_POSITIVE",
  };

  return { status: gate.status, reasons: [...new Set(gate.reasons)], checks, profit, freshness: freshnessChecks };
}

/** Rows are expected newest-first; keeps the first row per key. */
export function latestByKey<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    if (!map.has(k)) map.set(k, row);
  }
  return map;
}

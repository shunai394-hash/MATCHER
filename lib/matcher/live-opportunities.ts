import { createClient } from "@supabase/supabase-js";
import { scoreOpportunity, type OpportunityResult } from "./opportunity";

type SupplierOffer = {
  id: string;
  supplier_product_id: string;
  currency: string;
  orderability: "ORDERABLE" | "OUT_OF_STOCK" | "UNKNOWN" | "BLOCKED";
};
type SupplierProduct = {
  id: string; supplier_id: string; product_name: string; brand: string | null;
  model_number: string | null; color: string | null; size: string | null;
  capacity: string | null; set_count: number | null; condition: string | null;
};
type Supplier = { id: string; name: string };
type ProfitSnapshot = {
  supplier_offer_id: string; sale_price: number | string; supplier_cost: number | string | null;
  shipping_cost: number | string | null; payment_fee: number | string | null;
  marketplace_fee: number | string | null; tax: number | string | null;
  other_cost: number | string | null; expected_profit: number | string | null; calculated_at: string;
};
type IdentityMatch = {
  supplier_product_id: string; master_product_id: string;
  decision: "AUTO_LINK" | "REVIEW" | "REJECT" | "BLOCK"; hard_block: boolean; created_at: string;
};
type Freshness = {
  supplier_offer_id: string; price_observed_at: string | null;
  inventory_observed_at: string | null; shipping_observed_at: string | null;
};
type FreshnessPolicy = { data_type: "PRICE" | "INVENTORY" | "SHIPPING"; max_age_seconds: number };
type MarketObservation = {
  master_product_id: string; source: string; window_start: string; window_end: string;
  sales_count: number; active_listing_count: number;
  median_sale_price: number | string | null; price_stddev: number | string | null;
  observed_at: string; evidence_url: string | null;
};

export type LiveOpportunity = {
  id: string; product: string; supplier: string; buy: number; sell: number; profit: number;
  roiPercent: number; score: OpportunityResult["score"]; tier: OpportunityResult["tier"];
  identityStrength: number; freshness: number; orderability: SupplierOffer["orderability"];
  costComplete: boolean; calculatedAt: string; demandVelocity: number; competition: number;
  priceStability: number; marketSource: string; marketObservedAt: string; reasons: string[];
};
export type LiveOpportunityFeed = {
  status: "LIVE" | "EMPTY" | "UNAVAILABLE"; opportunities: LiveOpportunity[]; message: string;
};

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function parseTimestamp(value: string | null | undefined): number | null {\n  if (!value) return null;\n  const parsed = Date.parse(value);\n  return Number.isFinite(parsed) ? parsed : null;\n}\n\nfunction freshnessScore(freshness: Freshness | undefined, policies: Map<FreshnessPolicy["data_type"], number>): number {
  if (!freshness) return 0;
  const now = Date.now();
  const ages = [
    ["PRICE", freshness.price_observed_at],
    ["INVENTORY", freshness.inventory_observed_at],
    ["SHIPPING", freshness.shipping_observed_at],
  ] as const;
  const scores = ages.map(([type, observedAt]) => {
    if (!observedAt) return 0;
    const maxAge = policies.get(type);
    if (!maxAge) return 0;
    const age = Math.max(0, (now - observedMs) / 1000);
    return Math.max(0, Math.min(100, 100 * (1 - age / maxAge)));
  });
  return Math.round(Math.min(...scores));
}
function marketFreshnessScore(observedAt: string): number {
  const ageHours = Math.max(0, (Date.now() - Date.parse(observedAt)) / 3_600_000);
  return Math.max(0, Math.min(100, 100 * (1 - ageHours / 24)));
}

export function marketScores(row: MarketObservation) {
  const windowDays = Math.max(1 / 24, (Date.parse(row.window_end) - Date.parse(row.window_start)) / 86_400_000);
  const demandVelocity = Math.round(Math.min(100, (row.sales_count / windowDays) * 10));
  // This value is pressure. scoreOpportunity subtracts competition pressure.
  const competition = row.active_listing_count > 0
    ? Math.round(Math.min(100, (100 * Math.log10(row.active_listing_count + 1)) / Math.log10(101)))
    : 0;
  const median = numberOrNull(row.median_sale_price);
  const stddev = numberOrNull(row.price_stddev);
  const priceStability = median !== null && median > 0 && stddev !== null
    ? Math.round(Math.max(0, Math.min(100, 100 - (stddev / median) * 100))) : 0;
  return { demandVelocity, competition, priceStability };
}
function latestBy<T>(rows: T[], key: (row: T) => string, date: (row: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    const existing = result.get(k);
    if (!existing || Date.parse(date(row)) > Date.parse(date(existing))) result.set(k, row);
  }
  return result;
}

export async function getLiveOpportunities(limit = 20): Promise<LiveOpportunityFeed> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { status: "UNAVAILABLE", opportunities: [], message: "Live data connection is not configured." };
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const [offersResult, productsResult, suppliersResult, profitsResult, matchesResult, freshnessResult, policiesResult, marketResult] =
      await Promise.all([
        supabase.from("supplier_offer").select("id,supplier_product_id,currency,orderability").limit(1000),
        supabase.from("supplier_product").select("id,supplier_id,product_name,brand,model_number,color,size,capacity,set_count,condition").limit(1000),
        supabase.from("supplier").select("id,name").limit(500),
        supabase.from("profit_snapshot").select("supplier_offer_id,sale_price,supplier_cost,shipping_cost,payment_fee,marketplace_fee,tax,other_cost,expected_profit,calculated_at").order("calculated_at", { ascending: false }).limit(2000),
        supabase.from("identity_match").select("supplier_product_id,master_product_id,decision,hard_block,created_at").order("created_at", { ascending: false }).limit(2000),
        supabase.from("supplier_offer_freshness").select("supplier_offer_id,price_observed_at,inventory_observed_at,shipping_observed_at").limit(2000),
        supabase.from("freshness_policy").select("data_type,max_age_seconds"),
        supabase.from("market_observation").select("master_product_id,source,window_start,window_end,sales_count,active_listing_count,median_sale_price,price_stddev,observed_at,evidence_url").order("observed_at", { ascending: false }).limit(2000),
      ]);
    const firstError = [offersResult, productsResult, suppliersResult, profitsResult, matchesResult, freshnessResult, policiesResult, marketResult].find((result) => result.error)?.error;
    if (firstError) throw new Error(firstError.message);
    const offers = (offersResult.data ?? []) as SupplierOffer[];
    if (offers.length === 0) return { status: "EMPTY", opportunities: [], message: "Live database is connected, but no supplier offers are available yet." };
    const products = new Map(((productsResult.data ?? []) as SupplierProduct[]).map((row) => [row.id, row]));
    const suppliers = new Map(((suppliersResult.data ?? []) as Supplier[]).map((row) => [row.id, row]));
    const profits = latestBy((profitsResult.data ?? []) as ProfitSnapshot[], (row) => row.supplier_offer_id, (row) => row.calculated_at);
    const matches = latestBy((matchesResult.data ?? []) as IdentityMatch[], (row) => row.supplier_product_id, (row) => row.created_at);
    const freshness = new Map(((freshnessResult.data ?? []) as Freshness[]).map((row) => [row.supplier_offer_id, row]));
    const policies = new Map(((policiesResult.data ?? []) as FreshnessPolicy[]).map((row) => [row.data_type, row.max_age_seconds]));
    const markets = latestBy((marketResult.data ?? []) as MarketObservation[], (row) => row.master_product_id, (row) => row.observed_at);
    const opportunities: LiveOpportunity[] = [];
    for (const offer of offers) {
      const product = products.get(offer.supplier_product_id);
      const profit = profits.get(offer.id);
      const match = matches.get(offer.supplier_product_id);
      if (!product || !profit || !match || !match.master_product_id) continue;
      const market = markets.get(match.master_product_id);
      if (!market) continue;
      const marketAgeHours = Math.max(0, (Date.now() - Date.parse(market.observed_at)) / 3_600_000);
      if (marketAgeHours > 24) continue;
      const sale = numberOrNull(profit.sale_price);
      const buy = numberOrNull(profit.supplier_cost);
      const shipping = numberOrNull(profit.shipping_cost) ?? 0;
      const expectedProfit = numberOrNull(profit.expected_profit);
      const costComplete = [profit.supplier_cost, profit.shipping_cost, profit.payment_fee, profit.marketplace_fee, profit.tax, profit.other_cost].every((value) => numberOrNull(value) !== null);
      if (sale === null || buy === null || expectedProfit === null || !costComplete) continue;
      const totalAcquisition = buy + shipping;
      const roiPercent = totalAcquisition > 0 ? (expectedProfit / totalAcquisition) * 100 : 0;
      const identityStrength = match.decision === "AUTO_LINK" && !match.hard_block ? 100 : match.decision === "REVIEW" ? 60 : 0;
      const supplierFreshness = freshnessScore(freshness.get(offer.id), policies);
      const marketFreshness = Math.round(marketFreshnessScore(market.observed_at));
      const freshnessValue = Math.min(supplierFreshness, marketFreshness);
      const marketSignal = marketScores(market);
      const scored = scoreOpportunity({
        expectedProfit, roiPercent, salesVelocity: marketSignal.demandVelocity, competition: marketSignal.competition,
        priceStability: marketSignal.priceStability, freshness: freshnessValue, identityStrength,
        risk: match.hard_block || offer.orderability !== "ORDERABLE" ? 100 : 35,
      });
      opportunities.push({
        id: offer.id, product: product.product_name, supplier: suppliers.get(product.supplier_id)?.name ?? "Unknown supplier",
        buy, sell: sale, profit: expectedProfit, roiPercent: Math.round(roiPercent * 10) / 10, score: scored.score, tier: scored.tier,
        identityStrength, freshness: freshnessValue, demandVelocity: marketSignal.demandVelocity, competition: marketSignal.competition,
        priceStability: marketSignal.priceStability, marketSource: market.source, marketObservedAt: market.observed_at,
        orderability: offer.orderability, costComplete, calculatedAt: profit.calculated_at,
        reasons: [...scored.reasons, "market: " + market.source, "demand " + marketSignal.demandVelocity + "/100",
          "competition " + marketSignal.competition + "/100", "price stability " + marketSignal.priceStability + "/100"],
      });
    }
    opportunities.sort((a, b) => b.score - a.score || b.profit - a.profit);
    return {
      status: opportunities.length > 0 ? "LIVE" : "EMPTY",
      opportunities: opportunities.slice(0, limit),
      message: opportunities.length > 0 ? "Ranked from live supplier offers and verified profit snapshots."
        : "Live offers exist, but none have enough verified economics, identity, freshness and market evidence for ranking.",
    };
  } catch {
    return { status: "UNAVAILABLE", opportunities: [], message: "Live opportunity data could not be read safely." };
  }
}

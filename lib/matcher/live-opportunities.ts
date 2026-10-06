import { createClient } from "@supabase/supabase-js";
import { scoreOpportunity, type OpportunityResult } from "./opportunity";

type Offer = {
  id: string;
  supplier_product_id: string;
  currency: string;
  orderability: "ORDERABLE" | "OUT_OF_STOCK" | "UNKNOWN" | "BLOCKED";
};

type Product = {
  id: string;
  supplier_id: string;
  product_name: string;
  brand: string | null;
  model_number: string | null;
};

type Supplier = { id: string; name: string };

type Snapshot = {
  supplier_offer_id: string;
  supplier_cost: number | string | null;
  shipping_cost: number | string | null;
  inventory: number | null;
  shipping_confidence: number | string | null;
  observed_at: string;
};

type Freshness = {
  supplier_offer_id: string;
  price_observed_at: string | null;
  inventory_observed_at: string | null;
  shipping_observed_at: string | null;
};

type Profit = {
  supplier_offer_id: string;
  sale_price: number | string;
  supplier_cost: number | string | null;
  shipping_cost: number | string | null;
  payment_fee: number | string | null;
  marketplace_fee: number | string | null;
  tax: number | string | null;
  other_cost: number | string | null;
  expected_profit: number | string | null;
  calculated_at: string;
};

type IdentityMatch = {
  supplier_product_id: string;
  master_product_id: string;
  confidence: number | string;
  decision: "AUTO_LINK" | "REVIEW" | "REJECT" | "BLOCK";
  hard_block: boolean;
  created_at: string;
};

type Market = {
  master_product_id: string;
  source: string;
  window_start: string;
  window_end: string;
  sales_count: number;
  active_listing_count: number;
  median_sale_price: number | string | null;
  price_stddev: number | string | null;
  observed_at: string;
  evidence_url: string | null;
};

export type LiveOpportunity = {
  id: string;
  product: string;
  supplier: string;
  buy: number;
  sell: number;
  profit: number;
  roiPercent: number;
  score: OpportunityResult["score"];
  tier: OpportunityResult["tier"];
  identityStrength: number;
  freshness: number;
  orderability: Offer["orderability"];
  costComplete: boolean;
  calculatedAt: string;
  demandVelocity: number;
  competition: number;
  priceStability: number;
  marketSource: string;
  marketObservedAt: string;
  reasons: string[];
};

export type LiveOpportunityFeed = {
  status: "LIVE" | "EMPTY" | "UNAVAILABLE";
  opportunities: LiveOpportunity[];
  message: string;
};

function finite(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

function latestBy<T>(rows: T[], key: (row: T) => string, date: (row: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    const t = time(date(row));
    if (t === null) continue;
    const prev = out.get(k);
    const pt = prev ? time(date(prev)) : null;
    if (pt === null || t > pt) out.set(k, row);
  }
  return out;
}

function freshnessScore(row: Freshness): number {
  const now = Date.now();
  const price = time(row.price_observed_at);
  const inventory = time(row.inventory_observed_at);
  const shipping = time(row.shipping_observed_at);
  if (price === null || inventory === null || shipping === null || price > now || inventory > now || shipping > now) return 0;

  const priceScore = Math.max(0, Math.min(100, 100 * (1 - (now - price) / (24 * 60 * 60 * 1000))));
  const inventoryScore = Math.max(0, Math.min(100, 100 * (1 - (now - inventory) / (30 * 60 * 1000))));
  const shippingScore = Math.max(0, Math.min(100, 100 * (1 - (now - shipping) / (24 * 60 * 60 * 1000))));
  return Math.round(Math.min(priceScore, inventoryScore, shippingScore));
}

function marketFreshness(observedAt: string): number {
  const t = time(observedAt);
  if (t === null || t > Date.now()) return 0;
  return Math.max(0, Math.min(100, 100 * (1 - (Date.now() - t) / (24 * 60 * 60 * 1000))));
}

export function marketScores(row: Market) {
  const start = time(row.window_start);
  const end = time(row.window_end);
  const median = finite(row.median_sale_price);
  const stddev = finite(row.price_stddev);
  const observedAt = time(row.observed_at);
  if (start === null || end === null || end <= start || observedAt === null || observedAt > Date.now() || end > Date.now() || observedAt < end) {
    return { demandVelocity: 0, competition: 0, priceStability: 0 };
  }

  const days = Math.max(1 / 24, (end - start) / 86_400_000);
  const sales = Number.isFinite(row.sales_count) && row.sales_count >= 0 ? row.sales_count : 0;
  const listings = Number.isFinite(row.active_listing_count) && row.active_listing_count >= 0
    ? row.active_listing_count
    : 0;

  return {
    demandVelocity: Math.round(Math.min(100, (sales / days) * 10)),
    competition: listings > 0
      ? Math.round(Math.min(100, (100 * Math.log10(listings + 1)) / Math.log10(101)))
      : 0,
    priceStability: median !== null && median > 0 && stddev !== null && stddev >= 0
      ? Math.round(Math.max(0, Math.min(100, 100 - (stddev / median) * 100)))
      : 0,
  };
}

export async function getLiveOpportunities(limit = 20): Promise<LiveOpportunityFeed> {
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 20;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return { status: "UNAVAILABLE", opportunities: [], message: "Live data connection is not configured." };
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const [offersResult, productsResult, suppliersResult, snapshotsResult, freshnessResult, profitsResult, matchesResult, marketResult] =
      await Promise.all([
        supabase.from("supplier_offer").select("id,supplier_product_id,currency,orderability").limit(2000),
        supabase.from("supplier_product").select("id,supplier_id,product_name,brand,model_number").limit(2000),
        supabase.from("supplier").select("id,name").limit(500),
        supabase.from("supplier_offer_snapshot").select("supplier_offer_id,supplier_cost,shipping_cost,inventory,shipping_confidence,observed_at").order("observed_at", { ascending: false }).limit(4000),
        supabase.from("supplier_offer_freshness").select("supplier_offer_id,price_observed_at,inventory_observed_at,shipping_observed_at").limit(4000),
        supabase.from("profit_snapshot").select("supplier_offer_id,sale_price,supplier_cost,shipping_cost,payment_fee,marketplace_fee,tax,other_cost,expected_profit,calculated_at").order("calculated_at", { ascending: false }).limit(4000),
        supabase.from("identity_match").select("supplier_product_id,master_product_id,confidence,decision,hard_block,created_at").order("created_at", { ascending: false }).limit(4000),
        supabase.from("market_observation").select("master_product_id,source,window_start,window_end,sales_count,active_listing_count,median_sale_price,price_stddev,observed_at,evidence_url").order("observed_at", { ascending: false }).limit(4000),
      ]);

    const error = [offersResult, productsResult, suppliersResult, snapshotsResult, freshnessResult, profitsResult, matchesResult, marketResult]
      .find((r) => r.error)?.error;
    if (error) throw new Error(error.message);

    const offers = (offersResult.data ?? []) as Offer[];
    if (offers.length === 0) {
      return {
        status: "EMPTY",
        opportunities: [],
        message: "MATCHER is connected, but the supplier ingestion layer has not loaded any offers yet.",
      };
    }

    const products = new Map(((productsResult.data ?? []) as Product[]).map((x) => [x.id, x]));
    const suppliers = new Map(((suppliersResult.data ?? []) as Supplier[]).map((x) => [x.id, x]));
    const snapshots = latestBy((snapshotsResult.data ?? []) as Snapshot[], (x) => x.supplier_offer_id, (x) => x.observed_at);
    const freshness = new Map(((freshnessResult.data ?? []) as Freshness[]).map((x) => [x.supplier_offer_id, x]));
    const profits = latestBy((profitsResult.data ?? []) as Profit[], (x) => x.supplier_offer_id, (x) => x.calculated_at);
    const matches = latestBy((matchesResult.data ?? []) as IdentityMatch[], (x) => x.supplier_product_id, (x) => x.created_at);
    const markets = latestBy((marketResult.data ?? []) as Market[], (x) => x.master_product_id, (x) => x.observed_at);

    const opportunities: LiveOpportunity[] = [];

    for (const offer of offers) {
      if (offer.orderability !== "ORDERABLE") continue;
      const product = products.get(offer.supplier_product_id);
      const snapshot = snapshots.get(offer.id);
      const profit = profits.get(offer.id);
      const match = matches.get(offer.supplier_product_id);
      if (!product || !snapshot || !profit || !match?.master_product_id) continue;
      if (match.decision !== "AUTO_LINK" || match.hard_block) continue;

      const market = markets.get(match.master_product_id);
      if (!market || marketFreshness(market.observed_at) < 70) continue;

      const sale = finite(profit.sale_price);
      const buy = finite(profit.supplier_cost ?? snapshot.supplier_cost);
      const shipping = finite(profit.shipping_cost ?? snapshot.shipping_cost);
      const expectedProfit = finite(profit.expected_profit);
      const costsComplete = [
        buy, shipping, finite(profit.payment_fee), finite(profit.marketplace_fee),
        finite(profit.tax), finite(profit.other_cost),
      ].every((x) => x !== null);

      if (sale === null || buy === null || shipping === null || expectedProfit === null || !costsComplete) continue;
      if (sale <= 0 || buy <= 0 || expectedProfit <= 0) continue;

      const acquisitionCost = buy + shipping;
      if (!Number.isFinite(acquisitionCost) || acquisitionCost <= 0) continue;

      const supplierFreshness = freshness.get(offer.id);
      if (!supplierFreshness) continue;
      const fresh = Math.min(freshnessScore(supplierFreshness), Math.round(marketFreshness(market.observed_at)));
      if (fresh < 70) continue;

      const roiPercent = (expectedProfit / acquisitionCost) * 100;
      if (!Number.isFinite(roiPercent)) continue;

      const signal = marketScores(market);
      const scored = scoreOpportunity({
        expectedProfit,
        roiPercent,
        salesVelocity: signal.demandVelocity,
        competition: signal.competition,
        priceStability: signal.priceStability,
        freshness: fresh,
        identityStrength: Math.round(Math.max(0, Math.min(100, (finite(match.confidence) ?? 0) * 100))),
        risk: 0,
      });
      if (scored.tier === "REJECT") continue;

      opportunities.push({
        id: offer.id,
        product: product.product_name,
        supplier: suppliers.get(product.supplier_id)?.name ?? "Unknown supplier",
        buy,
        sell: sale,
        profit: expectedProfit,
        roiPercent: Math.round(roiPercent * 10) / 10,
        score: scored.score,
        tier: scored.tier,
        identityStrength: Math.round((finite(match.confidence) ?? 0) * 100),
        freshness: fresh,
        orderability: offer.orderability,
        costComplete: true,
        calculatedAt: profit.calculated_at,
        demandVelocity: signal.demandVelocity,
        competition: signal.competition,
        priceStability: signal.priceStability,
        marketSource: market.source,
        marketObservedAt: market.observed_at,
        reasons: [
          ...scored.reasons,
          "identity: AUTO_LINK",
          "market: " + market.source,
          "demand " + signal.demandVelocity + "/100",
          "competition " + signal.competition + "/100",
          "price stability " + signal.priceStability + "/100",
        ],
      });
    }

    opportunities.sort((a, b) =>
      b.score - a.score ||
      b.profit - a.profit ||
      b.roiPercent - a.roiPercent ||
      a.id.localeCompare(b.id),
    );
    return {
      status: opportunities.length > 0 ? "LIVE" : "EMPTY",
      opportunities: opportunities.slice(0, safeLimit),
      message: opportunities.length > 0
        ? "Ranked from live supplier offers, identity matches, fresh observations, market evidence and complete costs."
        : "Supplier data exists, but no offer has passed every identity, freshness, market and complete-cost gate.",
    };
  } catch {
    return {
      status: "UNAVAILABLE",
      opportunities: [],
      message: "Live opportunity data could not be read safely.",
    };
  }
}

import { createClient } from "@supabase/supabase-js";
import { scoreOpportunity, type OpportunityResult } from "./opportunity";

type SupplierOffer = {
  id: string;
  supplier_product_id: string;
  cost: number | string | null;
  shipping_cost: number | string | null;
  currency: string;
  orderability: "ORDERABLE" | "OUT_OF_STOCK" | "UNKNOWN" | "BLOCKED";
  observed_at: string;
  price_age_seconds: number | null;
  inventory_age_seconds: number | null;
  shipping_verified: boolean;
};

type SupplierProduct = {
  id: string;
  supplier_id: string;
  title: string;
  brand: string | null;
  model_number: string | null;
};

type Supplier = { id: string; name: string };

type ProfitSnapshot = {
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
  cost_complete: boolean;
};

type MatchResult = {
  supplier_product_id: string;
  master_product_id: string | null;
  decision: "AUTO_LINK" | "REVIEW" | "BLOCK" | "REJECT";
  hard_block_reasons: unknown;
  created_at: string;
};

type MarketObservation = {
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
  orderability: SupplierOffer["orderability"];
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
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsedTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ageScore(ageSeconds: number | null, maxAgeSeconds: number): number {
  if (ageSeconds === null || !Number.isFinite(ageSeconds) || ageSeconds < 0 || maxAgeSeconds <= 0) return 0;
  return Math.max(0, Math.min(100, 100 * (1 - ageSeconds / maxAgeSeconds)));
}

function supplierFreshness(offer: SupplierOffer): number {
  const observedAt = parsedTime(offer.observed_at);
  if (observedAt === null) return 0;

  const priceScore = ageScore(offer.price_age_seconds, 24 * 60 * 60);
  const inventoryScore = ageScore(offer.inventory_age_seconds, 30 * 60);
  const shippingScore = offer.shipping_verified ? 100 : 0;

  // The slowest required dimension controls sellability.
  return Math.round(Math.min(priceScore, inventoryScore, shippingScore));
}

function marketFreshness(observedAt: string): number {
  const timestamp = parsedTime(observedAt);
  if (timestamp === null) return 0;
  const ageHours = Math.max(0, (Date.now() - timestamp) / 3_600_000);
  return Math.max(0, Math.min(100, 100 * (1 - ageHours / 24)));
}

export function marketScores(row: MarketObservation) {
  const start = parsedTime(row.window_start);
  const end = parsedTime(row.window_end);
  const median = finite(row.median_sale_price);
  const stddev = finite(row.price_stddev);

  if (start === null || end === null || end <= start) {
    return { demandVelocity: 0, competition: 0, priceStability: 0 };
  }

  const sales = Number.isFinite(row.sales_count) && row.sales_count >= 0 ? row.sales_count : 0;
  const listings = Number.isFinite(row.active_listing_count) && row.active_listing_count >= 0
    ? row.active_listing_count
    : 0;
  const windowDays = Math.max(1 / 24, (end - start) / 86_400_000);

  const demandVelocity = Math.round(Math.min(100, (sales / windowDays) * 10));
  const competition = listings > 0
    ? Math.round(Math.min(100, (100 * Math.log10(listings + 1)) / Math.log10(101)))
    : 0;
  const priceStability = median !== null && median > 0 && stddev !== null && stddev >= 0
    ? Math.round(Math.max(0, Math.min(100, 100 - (stddev / median) * 100)))
    : 0;

  return { demandVelocity, competition, priceStability };
}

function latestBy<T>(
  rows: T[],
  key: (row: T) => string,
  date: (row: T) => string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    const timestamp = parsedTime(date(row));
    const existing = result.get(k);
    const existingTimestamp = existing ? parsedTime(date(existing)) : null;
    if (timestamp !== null && (existingTimestamp === null || timestamp > existingTimestamp)) {
      result.set(k, row);
    }
  }
  return result;
}

export async function getLiveOpportunities(limit = 20): Promise<LiveOpportunityFeed> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return {
      status: "UNAVAILABLE",
      opportunities: [],
      message: "Live data connection is not configured.",
    };
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const [
      offersResult,
      productsResult,
      suppliersResult,
      profitsResult,
      matchesResult,
      marketResult,
    ] = await Promise.all([
      supabase
        .from("supplier_offer")
        .select("id,supplier_product_id,cost,shipping_cost,currency,orderability,observed_at,price_age_seconds,inventory_age_seconds,shipping_verified")
        .limit(1000),
      supabase
        .from("supplier_product")
        .select("id,supplier_id,title,brand,model_number")
        .limit(1000),
      supabase.from("suppliers").select("id,name").limit(500),
      supabase
        .from("profit_snapshot")
        .select("supplier_offer_id,sale_price,supplier_cost,shipping_cost,payment_fee,marketplace_fee,tax,other_cost,expected_profit,calculated_at,cost_complete")
        .order("calculated_at", { ascending: false })
        .limit(2000),
      supabase
        .from("match_result")
        .select("supplier_product_id,master_product_id,decision,hard_block_reasons,created_at")
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase
        .from("market_observation")
        .select("master_product_id,source,window_start,window_end,sales_count,active_listing_count,median_sale_price,price_stddev,observed_at,evidence_url")
        .order("observed_at", { ascending: false })
        .limit(2000),
    ]);

    const firstError = [
      offersResult,
      productsResult,
      suppliersResult,
      profitsResult,
      matchesResult,
      marketResult,
    ].find((result) => result.error)?.error;

    if (firstError) throw new Error(firstError.message);

    const offers = (offersResult.data ?? []) as SupplierOffer[];
    if (offers.length === 0) {
      return {
        status: "EMPTY",
        opportunities: [],
        message: "Live database is connected, but no supplier offers are available yet.",
      };
    }

    const products = new Map(
      ((productsResult.data ?? []) as SupplierProduct[]).map((row) => [row.id, row]),
    );
    const suppliers = new Map(
      ((suppliersResult.data ?? []) as Supplier[]).map((row) => [row.id, row]),
    );
    const profits = latestBy(
      (profitsResult.data ?? []) as ProfitSnapshot[],
      (row) => row.supplier_offer_id,
      (row) => row.calculated_at,
    );
    const matches = latestBy(
      (matchesResult.data ?? []) as MatchResult[],
      (row) => row.supplier_product_id,
      (row) => row.created_at,
    );
    const markets = latestBy(
      (marketResult.data ?? []) as MarketObservation[],
      (row) => row.master_product_id,
      (row) => row.observed_at,
    );

    const opportunities: LiveOpportunity[] = [];

    for (const offer of offers) {
      const product = products.get(offer.supplier_product_id);
      const profit = profits.get(offer.id);
      const match = matches.get(offer.supplier_product_id);

      if (!product || !profit || !match?.master_product_id) continue;
      if (offer.orderability !== "ORDERABLE") continue;
      if (match.decision !== "AUTO_LINK" || !Array.isArray(match.hard_block_reasons) || match.hard_block_reasons.length > 0) continue;

      const market = markets.get(match.master_product_id);
      if (!market || marketFreshness(market.observed_at) < 70) continue;

      const sale = finite(profit.sale_price);
      const buy = finite(profit.supplier_cost);
      const expectedProfit = finite(profit.expected_profit);
      const shipping = finite(profit.shipping_cost);
      const costComplete =
        profit.cost_complete &&
        profit.supplier_cost !== null &&
        profit.shipping_cost !== null &&
        profit.payment_fee !== null &&
        profit.marketplace_fee !== null &&
        profit.tax !== null &&
        profit.other_cost !== null;

      if (sale === null || buy === null || expectedProfit === null || shipping === null || !costComplete) continue;
      if (expectedProfit <= 0 || buy <= 0 || sale <= 0) continue;

      const acquisitionCost = buy + shipping;
      if (!Number.isFinite(acquisitionCost) || acquisitionCost <= 0) continue;

      const roiPercent = (expectedProfit / acquisitionCost) * 100;
      const supplierFresh = supplierFreshness(offer);
      const marketFresh = Math.round(marketFreshness(market.observed_at));
      const freshness = Math.min(supplierFresh, marketFresh);
      if (freshness < 70) continue;

      const marketSignal = marketScores(market);
      const scored = scoreOpportunity({
        expectedProfit,
        roiPercent,
        salesVelocity: marketSignal.demandVelocity,
        competition: marketSignal.competition,
        priceStability: marketSignal.priceStability,
        freshness,
        identityStrength: 100,
        risk: 0,
      });

      if (scored.tier === "REJECT") continue;

      opportunities.push({
        id: offer.id,
        product: product.title,
        supplier: suppliers.get(product.supplier_id)?.name ?? "Unknown supplier",
        buy,
        sell: sale,
        profit: expectedProfit,
        roiPercent: Math.round(roiPercent * 10) / 10,
        score: scored.score,
        tier: scored.tier,
        identityStrength: 100,
        freshness,
        demandVelocity: marketSignal.demandVelocity,
        competition: marketSignal.competition,
        priceStability: marketSignal.priceStability,
        marketSource: market.source,
        marketObservedAt: market.observed_at,
        orderability: offer.orderability,
        costComplete,
        calculatedAt: profit.calculated_at,
        reasons: [
          ...scored.reasons,
          "identity: AUTO_LINK",
          "market: " + market.source,
          "demand " + marketSignal.demandVelocity + "/100",
          "competition " + marketSignal.competition + "/100",
          "price stability " + marketSignal.priceStability + "/100",
        ],
      });
    }

    opportunities.sort((a, b) => b.score - a.score || b.profit - a.profit);

    return {
      status: opportunities.length > 0 ? "LIVE" : "EMPTY",
      opportunities: opportunities.slice(0, limit),
      message: opportunities.length > 0
        ? "Ranked from live supplier offers, verified profit snapshots, identity matches and market observations."
        : "Live offers exist, but none have enough verified economics, identity, freshness and market evidence for ranking.",
    };
  } catch {
    return {
      status: "UNAVAILABLE",
      opportunities: [],
      message: "Live opportunity data could not be read safely.",
    };
  }
}

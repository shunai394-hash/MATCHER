import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { hasIngestionSession, ingestionTokenConfigured } from "../../../../lib/matcher/ingestion/auth";
import { isValidGlobalIdentifier, normalizeIdentifier } from "../../../../lib/matcher/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketFeedItem = {
  identifierType: "JAN" | "EAN" | "UPC";
  identifierValue: string;
  source: string;
  windowStart: string;
  windowEnd: string;
  salesCount: number;
  activeListingCount: number;
  medianSalePrice: number;
  priceStddev: number;
  observedAt: string;
  evidenceUrl: string;
};

function publicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
    const private172 = host.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    if (host === "::1" || host === "[::1]" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
    return true;
  } catch {
    return false;
  }
}

function validateItem(value: unknown): { item?: MarketFeedItem; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "INVALID_ITEM" };
  const row = value as Record<string, unknown>;
  const identifierType = row.identifierType;
  if (identifierType !== "JAN" && identifierType !== "EAN" && identifierType !== "UPC") return { error: "INVALID_IDENTIFIER_TYPE" };
  if (typeof row.identifierValue !== "string") return { error: "INVALID_IDENTIFIER" };
  const identifierValue = normalizeIdentifier(row.identifierValue);
  if (!identifierValue || !isValidGlobalIdentifier(identifierValue, identifierType)) return { error: "INVALID_GLOBAL_IDENTIFIER" };
  if (typeof row.source !== "string" || !/^[a-z0-9][a-z0-9._-]{0,39}$/i.test(row.source)) return { error: "INVALID_MARKET_SOURCE" };
  if (typeof row.windowStart !== "string" || typeof row.windowEnd !== "string" || typeof row.observedAt !== "string") return { error: "INVALID_OBSERVATION_WINDOW" };
  const start = Date.parse(row.windowStart);
  const end = Date.parse(row.windowEnd);
  const observed = Date.parse(row.observedAt);
  if (![start, end, observed].every(Number.isFinite) || end <= start || observed > Date.now() + 60_000) return { error: "INVALID_OBSERVATION_DATES" };
  if (!Number.isInteger(row.salesCount) || Number(row.salesCount) <= 0) return { error: "NO_SALES_EVIDENCE" };
  if (!Number.isInteger(row.activeListingCount) || Number(row.activeListingCount) < 0) return { error: "INVALID_LISTING_COUNT" };
  if (typeof row.medianSalePrice !== "number" || !Number.isFinite(row.medianSalePrice) || row.medianSalePrice <= 0) return { error: "INVALID_MEDIAN_SALE_PRICE" };
  if (typeof row.priceStddev !== "number" || !Number.isFinite(row.priceStddev) || row.priceStddev < 0) return { error: "INVALID_PRICE_STDDEV" };
  if (!publicHttpsUrl(row.evidenceUrl)) return { error: "INVALID_EVIDENCE_URL" };
  return {
    item: {
      identifierType,
      identifierValue,
      source: row.source.toLowerCase(),
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(end).toISOString(),
      salesCount: Number(row.salesCount),
      activeListingCount: Number(row.activeListingCount),
      medianSalePrice: row.medianSalePrice,
      priceStddev: row.priceStddev,
      observedAt: new Date(observed).toISOString(),
      evidenceUrl: row.evidenceUrl,
    },
  };
}

function freshEnough(value: string | null | undefined, maxAgeMs: number) {
  if (!value) return false;
  const observed = Date.parse(value);
  return Number.isFinite(observed) && observed <= Date.now() && Date.now() - observed <= maxAgeMs;
}

export async function POST(request: Request) {
  if (!ingestionTokenConfigured()) {
    return NextResponse.json({ ok: false, code: "INGESTION_AUTH_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!hasIngestionSession(request)) {
    return NextResponse.json({ ok: false, code: "INGESTION_AUTH_REQUIRED" }, { status: 401 });
  }

  const feedUrl = process.env.MATCHER_MARKET_OBSERVATION_FEED_URL;
  if (!feedUrl || !publicHttpsUrl(feedUrl)) {
    return NextResponse.json({ ok: false, code: "MARKET_OBSERVATION_FEED_NOT_CONFIGURED" }, { status: 503 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, code: "SUPABASE_SERVER_CREDENTIALS_NOT_CONFIGURED" }, { status: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(feedUrl, { cache: "no-store", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) return NextResponse.json({ ok: false, code: "MARKET_FEED_HTTP_ERROR", status: response.status }, { status: 502 });
    const body = await response.text();
    if (body.length > 5_000_000) return NextResponse.json({ ok: false, code: "MARKET_FEED_TOO_LARGE" }, { status: 413 });
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return NextResponse.json({ ok: false, code: "MARKET_FEED_INVALID_JSON" }, { status: 502 });
    }
    const rows = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items) ? (payload as { items: unknown[] }).items : null;
    if (!rows) return NextResponse.json({ ok: false, code: "MARKET_FEED_INVALID_SHAPE" }, { status: 502 });
    if (rows.length > 1000) return NextResponse.json({ ok: false, code: "MARKET_FEED_LIMIT_EXCEEDED" }, { status: 413 });

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: controller.signal ?? init?.signal }) },
    });
    const errors: Array<{ index: number; code: string }> = [];
    const policyCache = new Map<string, { marketplace_fee_rate: number; payment_fee_rate: number; fixed_fee: number; tax_rate: number } | null>();
    let persisted = 0;
    let profitSnapshots = 0;
    let skippedCosts = 0;

    for (let index = 0; index < rows.length; index += 1) {
      if (controller.signal.aborted) throw new DOMException("Market feed timed out", "AbortError");
      const validated = validateItem(rows[index]);
      if (!validated.item) {
        errors.push({ index, code: validated.error ?? "INVALID_ITEM" });
        continue;
      }
      const item = validated.item;
      const normalized = normalizeIdentifier(item.identifierValue);
      if (!normalized) {
        errors.push({ index, code: "INVALID_GLOBAL_IDENTIFIER" });
        continue;
      }
      const identifier = await supabase.from("product_identifier")
        .select("master_product_id")
        .eq("identifier_type", item.identifierType)
        .eq("normalized_value", normalized)
        .maybeSingle();
      if (identifier.error) {
        errors.push({ index, code: "MASTER_IDENTIFIER_LOOKUP_FAILED" });
        continue;
      }
      if (!identifier.data?.master_product_id) {
        errors.push({ index, code: "MASTER_PRODUCT_NOT_FOUND" });
        continue;
      }
      const masterProductId = identifier.data.master_product_id as string;
      const observation = await supabase.from("market_observation").upsert({
        master_product_id: masterProductId,
        source: item.source,
        window_start: item.windowStart,
        window_end: item.windowEnd,
        sales_count: item.salesCount,
        active_listing_count: item.activeListingCount,
        median_sale_price: item.medianSalePrice,
        price_stddev: item.priceStddev,
        observed_at: item.observedAt,
        evidence_url: item.evidenceUrl,
      }, { onConflict: "master_product_id,source,window_start,window_end" })
        .select("id")
        .single();
      if (observation.error || !observation.data?.id) {
        errors.push({ index, code: "MARKET_OBSERVATION_PERSIST_FAILED" });
        continue;
      }
      persisted += 1;

      if (!policyCache.has(item.source)) {
        const policy = await supabase.from("profit_fee_policy")
          .select("marketplace_fee_rate,payment_fee_rate,fixed_fee,tax_rate")
          .eq("marketplace", item.source)
          .eq("active", true)
          .maybeSingle();
        if (policy.error) {
          errors.push({ index, code: "FEE_POLICY_LOOKUP_FAILED" });
          policyCache.set(item.source, null);
        } else {
          policyCache.set(item.source, policy.data ? {
            marketplace_fee_rate: Number(policy.data.marketplace_fee_rate),
            payment_fee_rate: Number(policy.data.payment_fee_rate),
            fixed_fee: Number(policy.data.fixed_fee),
            tax_rate: Number(policy.data.tax_rate),
          } : null);
        }
      }
      const policy = policyCache.get(item.source);
      if (!policy) {
        skippedCosts += 1;
        continue;
      }

      const matches = await supabase.from("identity_match")
        .select("supplier_product_id")
        .eq("master_product_id", masterProductId)
        .eq("decision", "AUTO_LINK")
        .eq("hard_block", false)
        .limit(1000);
      if (matches.error) {
        errors.push({ index, code: "IDENTITY_MATCH_LOOKUP_FAILED" });
        continue;
      }
      const supplierProductIds = [...new Set((matches.data ?? []).map((match) => match.supplier_product_id as string))];
      if (!supplierProductIds.length) continue;
      const offersResult = await supabase.from("supplier_offer")
        .select("id,supplier_product_id,orderability")
        .in("supplier_product_id", supplierProductIds);
      if (offersResult.error) {
        errors.push({ index, code: "SUPPLIER_OFFER_LOOKUP_FAILED" });
        continue;
      }
      const offers = (offersResult.data ?? []).filter((offer) => offer.orderability === "ORDERABLE");
      const offerIds = offers.map((offer) => offer.id as string);
      if (!offerIds.length) continue;
      const [snapshotsResult, freshnessResult] = await Promise.all([
        supabase.from("supplier_offer_snapshot").select("supplier_offer_id,supplier_cost,shipping_cost,inventory,observed_at").in("supplier_offer_id", offerIds).order("observed_at", { ascending: false }).limit(5000),
        supabase.from("supplier_offer_freshness").select("supplier_offer_id,price_observed_at,inventory_observed_at,shipping_observed_at").in("supplier_offer_id", offerIds).limit(5000),
      ]);
      if (snapshotsResult.error || freshnessResult.error) {
        errors.push({ index, code: "SUPPLIER_ECONOMICS_LOOKUP_FAILED" });
        continue;
      }
      const latestSnapshots = new Map<string, (typeof snapshotsResult.data)[number]>();
      for (const snapshot of snapshotsResult.data ?? []) if (!latestSnapshots.has(snapshot.supplier_offer_id)) latestSnapshots.set(snapshot.supplier_offer_id, snapshot);
      const freshness = new Map((freshnessResult.data ?? []).map((row) => [row.supplier_offer_id as string, row]));
      for (const offer of offers) {
        const snapshot = latestSnapshots.get(offer.id);
        const fresh = freshness.get(offer.id);
        const buyPrice = snapshot?.supplier_cost == null ? null : Number(snapshot.supplier_cost);
        const shippingCost = snapshot?.shipping_cost == null ? null : Number(snapshot.shipping_cost);
        const inventory = snapshot?.inventory == null ? null : Number(snapshot.inventory);
        if (!snapshot || !fresh || buyPrice === null || buyPrice <= 0 || shippingCost === null || shippingCost < 0 || inventory === null || inventory <= 0 ||
          !freshEnough(fresh.price_observed_at, 24 * 60 * 60 * 1000) ||
          !freshEnough(fresh.inventory_observed_at, 30 * 60 * 1000) ||
          !freshEnough(fresh.shipping_observed_at, 24 * 60 * 60 * 1000)) {
          skippedCosts += 1;
          continue;
        }
        const salePrice = item.medianSalePrice;
        const marketplaceFee = salePrice * policy.marketplace_fee_rate;
        const paymentFee = salePrice * policy.payment_fee_rate;
        const tax = salePrice * policy.tax_rate;
        const expectedProfit = salePrice - buyPrice - shippingCost - marketplaceFee - paymentFee - tax - policy.fixed_fee;
        const storedProfit = await supabase.from("profit_snapshot").upsert({
          supplier_offer_id: offer.id,
          market_observation_id: observation.data.id,
          sale_price: salePrice,
          supplier_cost: buyPrice,
          shipping_cost: shippingCost,
          payment_fee: paymentFee,
          marketplace_fee: marketplaceFee,
          tax,
          other_cost: policy.fixed_fee,
          expected_profit: expectedProfit,
          calculated_at: item.observedAt,
        }, { onConflict: "supplier_offer_id,market_observation_id" });
        if (storedProfit.error) {
          errors.push({ index, code: "PROFIT_SNAPSHOT_PERSIST_FAILED" });
          continue;
        }
        profitSnapshots += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      discovered: rows.length,
      marketObservationsPersisted: persisted,
      profitSnapshotsPersisted: profitSnapshots,
      skippedForMissingCostsOrPolicy: skippedCosts,
      errors,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    return NextResponse.json({ ok: false, code: timedOut ? "MARKET_FEED_TIMEOUT" : "MARKET_FEED_PROCESSING_FAILED" }, { status: timedOut ? 504 : 502 });
  } finally {
    clearTimeout(timeout);
  }
}

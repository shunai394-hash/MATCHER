import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { recomputeOpportunities } from "@/lib/server/recompute";

export const dynamic = "force-dynamic";

const ORDERABILITY = ["ORDERABLE", "OUT_OF_STOCK", "UNKNOWN", "BLOCKED"] as const;
const IDENTIFIER_TYPES = ["JAN", "EAN", "UPC", "MPN", "SKU", "SUPPLIER_PRODUCT_NO"] as const;

type SupplierItem = {
  supplierKey: string;
  supplierName: string;
  supplierProductId: string;
  supplierSku?: string;
  /** Preferred. `title` is accepted as a legacy alias and stored in supplier_product.product_name. */
  productName?: string;
  title?: string;
  brand?: string;
  manufacturer?: string;
  modelNumber?: string;
  color?: string;
  size?: string;
  capacity?: string;
  generation?: string;
  setCount?: number;
  condition?: string;
  sourceUrl?: string;
  /** Supplier unit cost. Stored in supplier_offer_snapshot.supplier_cost. */
  cost?: number;
  shippingCost?: number;
  /** 0..1. Defaults to 1 when shippingCost is provided (the supplier quoted it), else 0. */
  shippingConfidence?: number;
  inventory?: number;
  orderability?: (typeof ORDERABILITY)[number];
  currency?: string;
  /** ISO timestamp of the observation at the supplier; defaults to now. */
  observedAt?: string;
  identifiers?: Array<{ type: (typeof IDENTIFIER_TYPES)[number]; value: string }>;
};

type MarketObservation = {
  masterProductId: string;
  productVariantId?: string;
  source: string;
  sourceProductId?: string;
  salePrice: number;
  paymentFee?: number;
  marketplaceFee?: number;
  tax?: number;
  otherCost?: number;
  sold?: boolean;
  sourceUrl?: string;
  observedAt?: string;
};

function auth(request: Request) {
  const expected = process.env.MATCHER_INGEST_TOKEN;
  return !!expected && request.headers.get("x-matcher-ingest-token") === expected;
}

const isText = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptText = (v: unknown) => v === undefined || v === null || typeof v === "string";
const isOptNonNeg = (v: unknown) => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const isOptTimestamp = (v: unknown) => v === undefined || v === null || (typeof v === "string" && Number.isFinite(new Date(v).getTime()));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateSupplierItem(item: SupplierItem, index: number): string[] {
  const p = `supplierItems[${index}]`;
  const errors: string[] = [];
  if (!item || typeof item !== "object") return [`${p}: must be an object`];
  if (!isText(item.supplierKey)) errors.push(`${p}.supplierKey is required`);
  if (!isText(item.supplierName)) errors.push(`${p}.supplierName is required`);
  if (!isText(item.supplierProductId)) errors.push(`${p}.supplierProductId is required`);
  for (const key of ["supplierSku", "productName", "title", "brand", "manufacturer", "modelNumber", "color", "size", "capacity", "generation", "condition", "sourceUrl"] as const) {
    if (!isOptText(item[key])) errors.push(`${p}.${key} must be a string`);
  }
  for (const key of ["cost", "shippingCost", "inventory"] as const) {
    if (!isOptNonNeg(item[key])) errors.push(`${p}.${key} must be a non-negative number`);
  }
  if (item.inventory != null && !Number.isInteger(item.inventory)) errors.push(`${p}.inventory must be an integer`);
  if (item.setCount != null && !(Number.isInteger(item.setCount) && item.setCount > 0)) errors.push(`${p}.setCount must be a positive integer`);
  if (item.shippingConfidence != null && !(typeof item.shippingConfidence === "number" && item.shippingConfidence >= 0 && item.shippingConfidence <= 1)) {
    errors.push(`${p}.shippingConfidence must be between 0 and 1`);
  }
  if (item.orderability != null && !ORDERABILITY.includes(item.orderability)) errors.push(`${p}.orderability must be one of ${ORDERABILITY.join(",")}`);
  if (item.currency != null && !/^[A-Za-z]{3}$/.test(item.currency)) errors.push(`${p}.currency must be a 3-letter code`);
  if (!isOptTimestamp(item.observedAt)) errors.push(`${p}.observedAt must be an ISO timestamp`);
  if (item.identifiers != null && !Array.isArray(item.identifiers)) return [...errors, `${p}.identifiers must be an array`];
  for (const [i, identifier] of (item.identifiers ?? []).entries()) {
    if (!identifier || !IDENTIFIER_TYPES.includes(identifier.type) || !isText(identifier.value)) {
      errors.push(`${p}.identifiers[${i}] must have type (${IDENTIFIER_TYPES.join(",")}) and value`);
    }
  }
  return errors;
}

function validateMarketObservation(obs: MarketObservation, index: number): string[] {
  const p = `marketObservations[${index}]`;
  const errors: string[] = [];
  if (!obs || typeof obs !== "object") return [`${p}: must be an object`];
  if (!isText(obs.masterProductId) || !UUID.test(obs.masterProductId)) errors.push(`${p}.masterProductId must be a UUID`);
  if (obs.productVariantId != null && !(isText(obs.productVariantId) && UUID.test(obs.productVariantId))) errors.push(`${p}.productVariantId must be a UUID`);
  if (!isText(obs.source)) errors.push(`${p}.source is required`);
  if (!(typeof obs.salePrice === "number" && Number.isFinite(obs.salePrice) && obs.salePrice >= 0)) errors.push(`${p}.salePrice must be a non-negative number`);
  for (const key of ["paymentFee", "marketplaceFee", "tax", "otherCost"] as const) {
    if (!isOptNonNeg(obs[key])) errors.push(`${p}.${key} must be a non-negative number`);
  }
  if (obs.sold != null && typeof obs.sold !== "boolean") errors.push(`${p}.sold must be a boolean`);
  if (!isOptText(obs.sourceProductId) || !isOptText(obs.sourceUrl)) errors.push(`${p}.sourceProductId/sourceUrl must be strings`);
  if (!isOptTimestamp(obs.observedAt)) errors.push(`${p}.observedAt must be an ISO timestamp`);
  return errors;
}

function normalizeIdentifier(type: string, value: string) {
  const compact = value.normalize("NFKC").trim().toUpperCase().replace(/[-\s]/g, "");
  return ["JAN", "EAN", "UPC"].includes(type) ? compact.replace(/\D/g, "") : compact;
}

function dbError(step: string, error: { message: string; code?: string }) {
  return new Error(`${step}: ${error.message}${error.code ? ` (${error.code})` : ""}`);
}

type Db = ReturnType<typeof getSupabaseAdmin>;

async function findOrCreateOffer(supabase: Db, supplierProductId: string, currency: string, orderability: string, now: string) {
  const findCanonical = () => supabase
    .from("supplier_offer")
    .select("id")
    .eq("supplier_product_id", supplierProductId)
    .eq("currency", currency)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // One offer per (supplier product, currency). The oldest row is canonical so concurrent
  // ingests converge on the same id even if a duplicate slipped in before the unique index.
  const existing = await findCanonical();
  if (existing.error) throw dbError("supplier_offer select", existing.error);
  if (existing.data) {
    const updated = await supabase.from("supplier_offer").update({ orderability, updated_at: now }).eq("id", existing.data.id).select("id").single();
    if (updated.error) throw dbError("supplier_offer update", updated.error);
    return updated.data.id as string;
  }
  const inserted = await supabase.from("supplier_offer").insert({ supplier_product_id: supplierProductId, currency, orderability, updated_at: now }).select("id").single();
  if (!inserted.error) return inserted.data.id as string;
  if (inserted.error.code !== "23505") throw dbError("supplier_offer insert", inserted.error);
  // Lost a race against another ingest (unique index): use the winner's row.
  const winner = await findCanonical();
  if (winner.error || !winner.data) throw dbError("supplier_offer select after conflict", winner.error ?? { message: "not found" });
  const updated = await supabase.from("supplier_offer").update({ orderability, updated_at: now }).eq("id", winner.data.id).select("id").single();
  if (updated.error) throw dbError("supplier_offer update", updated.error);
  return updated.data.id as string;
}

async function ingestSupplierItem(supabase: Db, item: SupplierItem, source: string) {
  const now = new Date().toISOString();
  const observedAt = item.observedAt ? new Date(item.observedAt).toISOString() : now;

  const supplier = await supabase.from("suppliers").upsert(
    { supplier_key: item.supplierKey.trim(), name: item.supplierName.trim(), status: "ACTIVE" },
    { onConflict: "supplier_key" },
  ).select("id").single();
  if (supplier.error) throw dbError("suppliers upsert", supplier.error);

  // Only send fields the source actually provided, so a partial feed never erases known attributes.
  const productRow: Record<string, unknown> = {
    supplier_id: supplier.data.id,
    supplier_product_id: item.supplierProductId.trim(),
    last_seen_at: now,
  };
  const optional: Array<[string, unknown]> = [
    ["supplier_sku", item.supplierSku],
    ["product_name", item.productName ?? item.title],
    ["brand", item.brand],
    ["manufacturer", item.manufacturer],
    ["model_number", item.modelNumber],
    ["color", item.color],
    ["size", item.size],
    ["capacity", item.capacity],
    ["generation", item.generation],
    ["set_count", item.setCount],
    ["condition", item.condition],
    ["source_url", item.sourceUrl],
  ];
  for (const [column, value] of optional) {
    if (value === undefined || value === null) continue;
    productRow[column] = typeof value === "string" ? value.trim() || null : value;
  }
  const product = await supabase.from("supplier_product")
    .upsert(productRow, { onConflict: "supplier_id,supplier_product_id" })
    .select("id")
    .single();
  if (product.error) throw dbError("supplier_product upsert", product.error);

  for (const identifier of item.identifiers ?? []) {
    const result = await supabase.from("supplier_product_identifier").upsert({
      supplier_product_id: product.data.id,
      identifier_type: identifier.type,
      identifier_value: identifier.value.trim(),
      normalized_value: normalizeIdentifier(identifier.type, identifier.value),
      source,
    }, { onConflict: "supplier_product_id,identifier_type,normalized_value" });
    if (result.error) throw dbError("supplier_product_identifier upsert", result.error);
  }

  const currency = (item.currency ?? "JPY").toUpperCase();
  const offerId = await findOrCreateOffer(supabase, product.data.id, currency, item.orderability ?? "UNKNOWN", now);

  const hasPrice = item.cost != null;
  const hasInventory = item.inventory != null;
  const hasShipping = item.shippingCost != null;
  const snapshot = await supabase.from("supplier_offer_snapshot").insert({
    supplier_offer_id: offerId,
    supplier_cost: item.cost ?? null,
    shipping_cost: item.shippingCost ?? null,
    inventory: item.inventory ?? null,
    shipping_confidence: item.shippingConfidence ?? (hasShipping ? 1 : 0),
    observed_at: observedAt,
  });
  if (snapshot.error) throw dbError("supplier_offer_snapshot insert", snapshot.error);

  // Freshness only moves forward for the facts this observation actually contained.
  const previous = await supabase.from("supplier_offer_freshness")
    .select("price_observed_at,inventory_observed_at,shipping_observed_at")
    .eq("supplier_offer_id", offerId)
    .maybeSingle();
  if (previous.error) throw dbError("supplier_offer_freshness select", previous.error);
  const later = (prev: string | null | undefined, observed: boolean) => {
    if (!observed) return prev ?? null;
    if (prev && new Date(prev).getTime() > new Date(observedAt).getTime()) return prev;
    return observedAt;
  };
  const freshness = await supabase.from("supplier_offer_freshness").upsert({
    supplier_offer_id: offerId,
    price_observed_at: later(previous.data?.price_observed_at, hasPrice),
    inventory_observed_at: later(previous.data?.inventory_observed_at, hasInventory),
    shipping_observed_at: later(previous.data?.shipping_observed_at, hasShipping),
    updated_at: now,
  }, { onConflict: "supplier_offer_id" });
  if (freshness.error) throw dbError("supplier_offer_freshness upsert", freshness.error);

  return { supplierProductId: product.data.id as string, supplierOfferId: offerId };
}

async function ingestMarketObservation(supabase: Db, obs: MarketObservation) {
  const result = await supabase.from("market_price_observation").insert({
    master_product_id: obs.masterProductId,
    product_variant_id: obs.productVariantId ?? null,
    source: obs.source.trim(),
    source_product_id: obs.sourceProductId ?? null,
    sale_price: obs.salePrice,
    payment_fee: obs.paymentFee ?? null,
    marketplace_fee: obs.marketplaceFee ?? null,
    tax: obs.tax ?? null,
    other_cost: obs.otherCost ?? null,
    sold: obs.sold ?? false,
    source_url: obs.sourceUrl ?? null,
    observed_at: obs.observedAt ? new Date(obs.observedAt).toISOString() : new Date().toISOString(),
  });
  if (result.error) throw dbError("market_price_observation insert", result.error);
}

export async function POST(request: Request) {
  if (!auth(request)) return NextResponse.json({ error: "INGEST_AUTH_REQUIRED" }, { status: 401 });

  let body: { source?: unknown; supplierItems?: unknown; marketObservations?: unknown; recompute?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const source = typeof body?.source === "string" ? body.source.trim() : "";
  if (!source) return NextResponse.json({ error: "SOURCE_REQUIRED" }, { status: 400 });
  if (body.supplierItems !== undefined && !Array.isArray(body.supplierItems)) return NextResponse.json({ error: "supplierItems must be an array" }, { status: 400 });
  if (body.marketObservations !== undefined && !Array.isArray(body.marketObservations)) return NextResponse.json({ error: "marketObservations must be an array" }, { status: 400 });
  const supplierItems = (body.supplierItems ?? []) as SupplierItem[];
  const marketObservations = (body.marketObservations ?? []) as MarketObservation[];
  if (!supplierItems.length && !marketObservations.length) return NextResponse.json({ error: "NOTHING_TO_INGEST" }, { status: 400 });

  // Validate everything before writing anything.
  const validationErrors = [
    ...supplierItems.flatMap(validateSupplierItem),
    ...marketObservations.flatMap(validateMarketObservation),
  ];
  if (validationErrors.length) return NextResponse.json({ error: "VALIDATION_FAILED", details: validationErrors }, { status: 400 });

  let supabase: Db;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "SUPABASE_CONFIG_ERROR" }, { status: 500 });
  }

  const run = await supabase.from("ingestion_run").insert({ source, status: "RUNNING" }).select("id").single();
  if (run.error) return NextResponse.json({ error: dbError("ingestion_run insert", run.error).message }, { status: 500 });

  let itemCount = 0;
  const errors: Array<{ kind: string; index: number; key: string; error: string }> = [];
  const written: Array<{ supplierProductId: string; supplierOfferId: string }> = [];

  for (const [index, item] of supplierItems.entries()) {
    try {
      written.push(await ingestSupplierItem(supabase, item, source));
      itemCount += 1;
    } catch (error) {
      errors.push({ kind: "supplierItem", index, key: `${item.supplierKey}/${item.supplierProductId}`, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const [index, obs] of marketObservations.entries()) {
    try {
      await ingestMarketObservation(supabase, obs);
      itemCount += 1;
    } catch (error) {
      errors.push({ kind: "marketObservation", index, key: obs.masterProductId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const status = errors.length === 0 ? "SUCCEEDED" : itemCount > 0 ? "PARTIAL" : "FAILED";
  const finish = await supabase.from("ingestion_run").update({
    status,
    item_count: itemCount,
    error_count: errors.length,
    finished_at: new Date().toISOString(),
  }).eq("id", run.data.id);

  const result: Record<string, unknown> = { ok: errors.length === 0, runId: run.data.id, status, itemCount, errorCount: errors.length, errors, written };
  if (finish.error) {
    return NextResponse.json({ ...result, ok: false, error: dbError("ingestion_run update", finish.error).message }, { status: 500 });
  }
  // Any failed row makes the whole request a failure (never a 2xx); rows already written are reported.
  if (errors.length) return NextResponse.json(result, { status: 500 });

  // New observations make earlier gate results outdated; re-evaluate right away so the
  // candidate list reflects this ingest (set "recompute": false to batch several ingests).
  if (body.recompute !== false) {
    try {
      result.recompute = await recomputeOpportunities(supabase);
    } catch (error) {
      return NextResponse.json({ ...result, ok: false, error: "RECOMPUTE_FAILED_AFTER_INGEST", detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }
  return NextResponse.json(result);
}

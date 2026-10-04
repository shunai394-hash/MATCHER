import type { getSupabaseAdmin } from "@/lib/server/supabase";
import { recomputeOpportunities } from "@/lib/server/recompute";
import type { MarketObservation, SupplierItem } from "@/lib/matcher/ingest-validation";

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

export type IngestResult = { httpStatus: number; body: Record<string, unknown> };

/**
 * Writes an already-validated batch. Any failed row makes the whole result a failure
 * (HTTP 500, ok:false) while reporting what was written; ingestion_run records the outcome.
 * After a fully successful write the opportunity pipeline is re-evaluated unless recompute=false.
 */
export async function runIngestion(supabase: Db, input: { source: string; supplierItems: SupplierItem[]; marketObservations: MarketObservation[]; recompute?: boolean }): Promise<IngestResult> {
  const { source, supplierItems, marketObservations } = input;
  const run = await supabase.from("ingestion_run").insert({ source, status: "RUNNING" }).select("id").single();
  if (run.error) return { httpStatus: 500, body: { ok: false, error: dbError("ingestion_run insert", run.error).message } };

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
  if (finish.error) return { httpStatus: 500, body: { ...result, ok: false, error: dbError("ingestion_run update", finish.error).message } };
  if (errors.length) return { httpStatus: 500, body: result };

  // New observations make earlier gate results outdated; re-evaluate right away so the
  // candidate list reflects this ingest (recompute: false batches several ingests).
  if (input.recompute !== false) {
    try {
      result.recompute = await recomputeOpportunities(supabase);
    } catch (error) {
      return { httpStatus: 500, body: { ...result, ok: false, error: "RECOMPUTE_FAILED_AFTER_INGEST", detail: error instanceof Error ? error.message : String(error) } };
    }
  }
  return { httpStatus: 200, body: result };
}

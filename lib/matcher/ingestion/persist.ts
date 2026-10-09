import { createClient } from "@supabase/supabase-js";
import { matchProductIdentity, normalizeIdentifier, type IdentityCandidate, type IdentityMatchResult, type ProductIdentifier } from "../identity";
import type { SourceProduct } from "./types";

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVER_CREDENTIALS_NOT_CONFIGURED");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function identityCandidate(item: SourceProduct): IdentityCandidate {
  return {
    brand: item.brand,
    modelNumber: item.modelNumber,
    title: item.productName,
    identifiers: (item.identifiers ?? []).map(({ type, value }) => ({ type, value })),
    color: item.color,
    size: item.size,
    capacity: item.capacity,
    generation: item.generation,
    setCount: item.setCount,
    condition: item.condition,
  };
}

function hasVariantData(item: SourceProduct) {
  return Boolean(item.color || item.size || item.capacity || item.generation || item.setCount != null || item.condition);
}

async function persistMasterIdentity(supabase: ReturnType<typeof db>, supplierProductId: string, sourceKey: string, item: SourceProduct) {
  const candidate = identityCandidate(item);
  const selfMatch = matchProductIdentity(candidate, candidate);
  if (selfMatch.decision !== "AUTO_LINK" || selfMatch.matchMethod !== "STRONG") {
    return { masterProductId: null, identityDecision: selfMatch.decision };
  }

  const identityRows = (item.identifiers ?? [])
    .filter((id) => ["JAN", "EAN", "UPC", "MPN"].includes(id.type))
    .map((id) => ({
      type: id.type,
      value: normalizeIdentifier(id.value),
      invalidGlobal: ["JAN", "EAN", "UPC"].includes(id.type) &&
        selfMatch.evidence.some((e) => e.field === id.type && e.reason.includes("invalid")),
    }))
    .filter((id) => id.value && !id.invalidGlobal) as Array<{ type: "JAN" | "EAN" | "UPC" | "MPN"; value: string; invalidGlobal: boolean }>;

  if (identityRows.length === 0) return { masterProductId: null, identityDecision: "REVIEW" as const };

  const existingOwnMaster = await supabase
    .from("master_product")
    .select("id,brand,product_name,manufacturer,model_number")
    .eq("origin_supplier_product_id", supplierProductId)
    .maybeSingle();
  if (existingOwnMaster.error) throw new Error(`MASTER_LOOKUP_FAILED:${existingOwnMaster.error.message}`);

  const lookup = await supabase
    .from("product_identifier")
    .select("master_product_id,identifier_type,identifier_value")
    .in("identifier_type", identityRows.map((x) => x.type))
    .in("identifier_value", identityRows.map((x) => x.value));
  if (lookup.error) throw new Error(`MASTER_IDENTIFIER_LOOKUP_FAILED:${lookup.error.message}`);

  const validPairs = new Set(identityRows.map((x) => x.type + ":" + x.value));
  const masterIds = new Set<string>((lookup.data ?? [])
    .filter((row) => validPairs.has(row.identifier_type + ":" + row.identifier_value))
    .map((row) => row.master_product_id));
  if (existingOwnMaster.data?.id) masterIds.add(existingOwnMaster.data.id);

  if (masterIds.size === 0) {
    const created = await supabase.from("master_product").insert({
      brand: item.brand ?? null,
      product_name: item.productName,
      manufacturer: item.manufacturer ?? null,
      model_number: item.modelNumber ?? null,
      approval_status: "CANDIDATE",
      origin: "SUPPLIER_CANDIDATE",
      origin_supplier_product_id: supplierProductId,
    }).select("id").single();
    if (created.error) throw new Error(`MASTER_CREATE_FAILED:${created.error.message}`);

    for (let i = 0; i < identityRows.length; i += 1) {
      const identifier = identityRows[i];
      const inserted = await supabase.from("product_identifier").insert({
        master_product_id: created.data.id,
        identifier_type: identifier.type,
        identifier_value: identifier.value,
        source: sourceKey,
        is_primary: i === 0,
      });
      if (inserted.error) throw new Error(`MASTER_IDENTIFIER_INSERT_FAILED:${inserted.error.message}`);
    }

    if (hasVariantData(item)) {
      const variant = await supabase.from("product_variant").insert({
        master_product_id: created.data.id,
        color: item.color ?? null,
        size: item.size ?? null,
        capacity: item.capacity ?? null,
        generation: item.generation ?? null,
        set_count: item.setCount ?? null,
        condition: item.condition ?? null,
      });
      if (variant.error) throw new Error(`MASTER_VARIANT_INSERT_FAILED:${variant.error.message}`);
    }

    const linked = await supabase.from("identity_match").insert({
      supplier_product_id: supplierProductId,
      master_product_id: created.data.id,
      confidence: 1,
      decision: "AUTO_LINK",
      hard_block: false,
    });
    if (linked.error) throw new Error(`IDENTITY_MATCH_INSERT_FAILED:${linked.error.message}`);
    return { masterProductId: created.data.id, identityDecision: "AUTO_LINK" as const };
  }

  const ids = [...masterIds];
  const [mastersResult, identifiersResult, variantsResult] = await Promise.all([
    supabase.from("master_product").select("id,brand,product_name,manufacturer,model_number").in("id", ids),
    supabase.from("product_identifier").select("master_product_id,identifier_type,identifier_value").in("master_product_id", ids),
    supabase.from("product_variant").select("master_product_id,color,size,capacity,generation,set_count,condition").in("master_product_id", ids),
  ]);
  const lookupError = mastersResult.error ?? identifiersResult.error ?? variantsResult.error;
  if (lookupError) throw new Error(`MASTER_DETAIL_LOOKUP_FAILED:${lookupError.message}`);

  const evaluations: Array<{ masterId: string; result: IdentityMatchResult }> = [];
  for (const master of mastersResult.data ?? []) {
    const masterIdentifiers = (identifiersResult.data ?? [])
      .filter((row) => row.master_product_id === master.id)
      .map((row) => ({ type: row.identifier_type as ProductIdentifier["type"], value: row.identifier_value }));
    const variants = (variantsResult.data ?? []).filter((row) => row.master_product_id === master.id);
    const candidates = variants.length ? variants : [null];
    const results = candidates.map((variant) => matchProductIdentity(candidate, {
      brand: master.brand,
      modelNumber: master.model_number,
      title: master.product_name,
      identifiers: masterIdentifiers,
      color: variant?.color ?? null,
      size: variant?.size ?? null,
      capacity: variant?.capacity ?? null,
      generation: variant?.generation ?? null,
      setCount: variant?.set_count ?? null,
      condition: variant?.condition ?? null,
    }));
    const strong = results.filter((result) => result.decision === "AUTO_LINK" && result.matchMethod === "STRONG");
    const result = strong.length === 1 ? strong[0]
      : strong.length > 1 ? { decision: "REVIEW", matchMethod: "WEAK", hardBlockReasons: [], evidence: [] } as IdentityMatchResult
      : results.every((value) => value.decision === "BLOCK") ? results[0]
      : { decision: "REVIEW", matchMethod: "WEAK", hardBlockReasons: [], evidence: [] } as IdentityMatchResult;
    evaluations.push({ masterId: master.id, result });
  }

  if (evaluations.length === 1) {
    const { masterId, result } = evaluations[0];
    const inserted = await supabase.from("identity_match").insert({
      supplier_product_id: supplierProductId,
      master_product_id: masterId,
      confidence: result.decision === "AUTO_LINK" ? 1 : result.decision === "BLOCK" ? 0 : 0.5,
      decision: result.decision,
      hard_block: result.decision === "BLOCK",
    });
    if (inserted.error) throw new Error(`IDENTITY_MATCH_INSERT_FAILED:${inserted.error.message}`);
    return { masterProductId: result.decision === "AUTO_LINK" ? masterId : null, identityDecision: result.decision };
  }

  for (const { masterId, result } of evaluations) {
    const inserted = await supabase.from("identity_match").insert({
      supplier_product_id: supplierProductId,
      master_product_id: masterId,
      confidence: result.decision === "BLOCK" ? 0 : 0.5,
      decision: result.decision === "BLOCK" ? "BLOCK" : "REVIEW",
      hard_block: result.decision === "BLOCK",
    });
    if (inserted.error) throw new Error(`IDENTITY_MATCH_INSERT_FAILED:${inserted.error.message}`);
  }
  return { masterProductId: null, identityDecision: "REVIEW" as const };
}

export async function persistSupplierDiscovery(sourceKey: string, item: SourceProduct) {
  const supabase = db();

  const supplier = await supabase
    .from("supplier")
    .upsert({ name: sourceKey, status: "ACTIVE" }, { onConflict: "name" })
    .select("id")
    .single();
  if (supplier.error) throw new Error(`SUPPLIER_UPSERT_FAILED:${supplier.error.message}`);

  const product = await supabase
    .from("supplier_product")
    .upsert({
      supplier_id: supplier.data.id,
      supplier_product_id: item.externalId,
      brand: item.brand,
      product_name: item.productName,
      manufacturer: item.manufacturer,
      model_number: item.modelNumber,
      color: item.color,
      size: item.size,
      capacity: item.capacity,
      generation: item.generation,
      set_count: item.setCount,
      condition: item.condition,
      source_url: item.sourceUrl,
      last_seen_at: item.observedAt,
    }, { onConflict: "supplier_id,supplier_product_id" })
    .select("id")
    .single();
  if (product.error) throw new Error(`SUPPLIER_PRODUCT_UPSERT_FAILED:${product.error.message}`);

  for (const identifier of item.identifiers ?? []) {
    const result = await supabase.from("supplier_product_identifier").upsert({
      supplier_product_id: product.data.id,
      identifier_type: identifier.type,
      identifier_value: identifier.value,
    }, { onConflict: "supplier_product_id,identifier_type,identifier_value" });
    if (result.error) throw new Error(`IDENTIFIER_UPSERT_FAILED:${result.error.message}`);
  }

  const offer = await supabase
    .from("supplier_offer")
    .upsert({
      supplier_product_id: product.data.id,
      currency: item.currency ?? "JPY",
      orderability: item.orderability ?? "UNKNOWN",
    }, { onConflict: "supplier_product_id" })
    .select("id")
    .single();
  if (offer.error) throw new Error(`OFFER_UPSERT_FAILED:${offer.error.message}`);

  const observedAt = item.observedAt ?? new Date().toISOString();
  const snapshot = await supabase.from("supplier_offer_snapshot").insert({
    supplier_offer_id: offer.data.id,
    supplier_cost: item.cost,
    shipping_cost: item.shippingCost,
    inventory: item.inventory,
    shipping_confidence: item.shippingCost == null ? null : 1,
    observed_at: observedAt,
  });
  if (snapshot.error) throw new Error(`SNAPSHOT_INSERT_FAILED:${snapshot.error.message}`);

  const freshness = await supabase.from("supplier_offer_freshness").upsert({
    supplier_offer_id: offer.data.id,
    price_observed_at: item.cost == null ? null : observedAt,
    inventory_observed_at: item.inventory == null ? null : observedAt,
    shipping_observed_at: item.shippingCost == null ? null : observedAt,
  }, { onConflict: "supplier_offer_id" });
  if (freshness.error) throw new Error(`FRESHNESS_UPSERT_FAILED:${freshness.error.message}`);

  const identity = await persistMasterIdentity(supabase, product.data.id, sourceKey, item);
  return { supplierId: supplier.data.id, supplierProductId: product.data.id, supplierOfferId: offer.data.id, ...identity };
}

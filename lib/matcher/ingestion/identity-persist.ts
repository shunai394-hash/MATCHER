import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidGlobalIdentifier,
  matchProductIdentity,
  normalizeIdentifier,
  normalizeText,
  type IdentityCandidate,
  type IdentityMatchResult,
  type ProductIdentifier,
} from "../identity";
import type { SourceProduct } from "./types";

type GlobalIdentifier = Extract<ProductIdentifier["type"], "JAN" | "EAN" | "UPC">;

function getVariantKey(item: Pick<SourceProduct, "color" | "size" | "capacity" | "generation" | "setCount" | "condition">) {
  const values = [item.color, item.size, item.capacity, item.generation, item.setCount == null ? null : String(item.setCount), item.condition]
    .map((value) => normalizeText(value == null ? null : String(value)));
  if (values.every((value) => value == null)) return null;
  return values.map((value) => value ?? "~").join("|");
}

function candidateIdentity(item: SourceProduct): IdentityCandidate {
  return {
    brand: item.brand,
    modelNumber: item.modelNumber,
    title: item.productName,
    identifiers: item.identifiers ?? [],
    color: item.color,
    size: item.size,
    capacity: item.capacity,
    generation: item.generation,
    setCount: item.setCount,
    condition: item.condition,
  };
}

function supportedIdentifiers(rows: Array<{ identifier_type: string; identifier_value: string }>): ProductIdentifier[] {
  const allowed = new Set<ProductIdentifier["type"]>(["JAN", "EAN", "UPC", "MPN", "SKU", "SUPPLIER_PRODUCT_NO"]);
  return rows.filter((row) => allowed.has(row.identifier_type as ProductIdentifier["type"]))
    .map((row) => ({ type: row.identifier_type as ProductIdentifier["type"], value: row.identifier_value }));
}

function masterWithVariant(
  master: { brand: string | null; product_name: string; model_number: string | null },
  identifiers: ProductIdentifier[],
  variant?: { color: string | null; size: string | null; capacity: string | null; generation: string | null; set_count: number | null; condition: string | null } | null,
): IdentityCandidate {
  return {
    brand: master.brand,
    modelNumber: master.model_number,
    title: master.product_name,
    identifiers,
    color: variant?.color ?? null,
    size: variant?.size ?? null,
    capacity: variant?.capacity ?? null,
    generation: variant?.generation ?? null,
    setCount: variant?.set_count ?? null,
    condition: variant?.condition ?? null,
  };
}

export async function persistIdentityMatch(
  supabase: SupabaseClient,
  supplierProductId: string,
  sourceKey: string,
  item: SourceProduct,
): Promise<{ masterProductId: string; result: IdentityMatchResult } | null> {
  const identifier = (item.identifiers ?? []).find((candidate): candidate is typeof candidate & { type: GlobalIdentifier } => {
    if (candidate.type !== "JAN" && candidate.type !== "EAN" && candidate.type !== "UPC") return false;
    const normalized = normalizeIdentifier(candidate.value);
    return Boolean(normalized && isValidGlobalIdentifier(normalized, candidate.type));
  });
  if (!identifier) return null;

  const normalizedValue = normalizeIdentifier(identifier.value);
  if (!normalizedValue) return null;

  const findMasterByIdentifier = async () => {
    const result = await supabase.from("product_identifier")
      .select("master_product_id")
      .eq("identifier_type", identifier.type)
      .eq("normalized_value", normalizedValue)
      .maybeSingle();
    if (result.error) throw new Error(`MASTER_IDENTIFIER_LOOKUP_FAILED:${result.error.message}`);
    return result.data?.master_product_id as string | undefined;
  };

  let masterProductId = await findMasterByIdentifier();
  if (!masterProductId) {
    const created = await supabase.from("master_product").insert({
      brand: item.brand ?? null,
      product_name: item.productName,
      manufacturer: item.manufacturer ?? null,
      model_number: item.modelNumber ?? null,
      status: "ACTIVE",
      approval_status: "PENDING",
      origin: "SUPPLIER_DISCOVERY",
      origin_supplier_product_id: supplierProductId,
    }).select("id").single();
    if (created.error || !created.data?.id) throw new Error(`MASTER_PRODUCT_CREATE_FAILED:${created.error?.message ?? "MISSING_ID"}`);
    masterProductId = created.data.id as string;

    const identifierInsert = await supabase.from("product_identifier").insert({
      master_product_id: masterProductId,
      identifier_type: identifier.type,
      identifier_value: identifier.value,
      normalized_value: normalizedValue,
      source: sourceKey,
      is_primary: true,
    });
    if (identifierInsert.error) {
      const existingMasterId = await findMasterByIdentifier();
      await supabase.from("master_product").delete().eq("id", masterProductId);
      if (!existingMasterId) throw new Error(`MASTER_IDENTIFIER_CREATE_FAILED:${identifierInsert.error.message}`);
      masterProductId = existingMasterId;
    } else {
      for (const extra of item.identifiers ?? []) {
        const extraValue = normalizeIdentifier(extra.value);
        if (!extraValue || (extra.type === identifier.type && extraValue === normalizedValue)) continue;
        const extraInsert = await supabase.from("product_identifier").insert({
          master_product_id: masterProductId,
          identifier_type: extra.type,
          identifier_value: extra.value,
          normalized_value: extraValue,
          source: sourceKey,
          is_primary: false,
        });
        if (extraInsert.error && extraInsert.error.code !== "23505") {
          throw new Error(`MASTER_IDENTIFIER_CREATE_FAILED:${extraInsert.error.message}`);
        }
      }
    }
  }

  const masterResult = await supabase.from("master_product")
    .select("id,brand,product_name,model_number")
    .eq("id", masterProductId)
    .single();
  if (masterResult.error || !masterResult.data) throw new Error(`MASTER_PRODUCT_READ_FAILED:${masterResult.error?.message ?? "NOT_FOUND"}`);

  const [masterIdentifiersResult, variantsResult] = await Promise.all([
    supabase.from("product_identifier").select("identifier_type,identifier_value").eq("master_product_id", masterProductId),
    supabase.from("product_variant").select("id,variant_key,color,size,capacity,generation,set_count,condition").eq("master_product_id", masterProductId),
  ]);
  if (masterIdentifiersResult.error) throw new Error(`MASTER_IDENTIFIERS_READ_FAILED:${masterIdentifiersResult.error.message}`);
  if (variantsResult.error) throw new Error(`MASTER_VARIANTS_READ_FAILED:${variantsResult.error.message}`);

  let variants = (variantsResult.data ?? []) as Array<{
    id: string; variant_key: string | null; color: string | null; size: string | null;
    capacity: string | null; generation: string | null; set_count: number | null; condition: string | null;
  }>;
  const key = getVariantKey(item);
  if (variants.length === 0 && key) {
    const variantInsert = await supabase.from("product_variant").insert({
      master_product_id: masterProductId,
      variant_key: key,
      color: item.color ?? null,
      size: item.size ?? null,
      capacity: item.capacity ?? null,
      generation: item.generation ?? null,
      set_count: item.setCount ?? null,
      condition: item.condition ?? null,
    });
    if (variantInsert.error && variantInsert.error.code !== "23505") {
      throw new Error(`MASTER_VARIANT_CREATE_FAILED:${variantInsert.error.message}`);
    }
    const reread = await supabase.from("product_variant")
      .select("id,variant_key,color,size,capacity,generation,set_count,condition")
      .eq("master_product_id", masterProductId);
    if (reread.error) throw new Error(`MASTER_VARIANTS_READ_FAILED:${reread.error.message}`);
    variants = (reread.data ?? []) as typeof variants;
  }

  const masterIdentifiers = supportedIdentifiers(masterIdentifiersResult.data ?? []);
  const master = masterResult.data as { id: string; brand: string | null; product_name: string; model_number: string | null };
  const candidate = candidateIdentity(item);
  const crossMasterConflicts: IdentityMatchResult["evidence"] = [];
  const crossMasterBlockReasons: string[] = [];
  for (const candidateIdentifier of item.identifiers ?? []) {
    if (candidateIdentifier.type !== "JAN" && candidateIdentifier.type !== "EAN" && candidateIdentifier.type !== "UPC") continue;
    const candidateValue = normalizeIdentifier(candidateIdentifier.value);
    if (!candidateValue) continue;
    const owner = await supabase.from("product_identifier").select("master_product_id")
      .eq("identifier_type", candidateIdentifier.type).eq("normalized_value", candidateValue).maybeSingle();
    if (owner.error) throw new Error(`GLOBAL_IDENTIFIER_LOOKUP_FAILED:${owner.error.message}`);
    if (owner.data?.master_product_id && owner.data.master_product_id !== masterProductId) {
      crossMasterBlockReasons.push(candidateIdentifier.type + "_MISMATCH");
      crossMasterConflicts.push({
        field: candidateIdentifier.type,
        candidate: candidateValue,
        master: "IDENTIFIER_ASSIGNED_TO_DIFFERENT_MASTER",
        result: "MISMATCH",
        reason: "A global identifier is already assigned to a different master product.",
      });
    }
  }
  let result: IdentityMatchResult;
  if (crossMasterBlockReasons.length > 0) {
    result = { decision: "BLOCK", matchMethod: "NONE", hardBlockReasons: [...new Set(crossMasterBlockReasons)], evidence: crossMasterConflicts };
  } else if (variants.length > 1 && !variants.some((variant) => variant.variant_key === key)) {
    const attempts = variants.map((variant) => matchProductIdentity(candidate, masterWithVariant(master, masterIdentifiers, variant)));
    if (attempts.length > 0 && attempts.every((attempt) => attempt.decision === "BLOCK")) {
      result = {
        decision: "BLOCK",
        matchMethod: "NONE",
        hardBlockReasons: [...new Set(attempts.flatMap((attempt) => attempt.hardBlockReasons))],
        evidence: attempts.flatMap((attempt) => attempt.evidence),
      };
    } else {
      result = {
        decision: "REVIEW",
        matchMethod: "WEAK",
        hardBlockReasons: [],
        evidence: [{
          field: "variant_key",
          candidate: key,
          master: variants.map((variant) => variant.variant_key).filter(Boolean).join(" | ") || null,
          result: "WEAK",
          reason: "複数のバリアントがあり完全一致するvariant keyがないため、自動で選択しません。",
        }],
      };
    }
  } else {
    const variant = variants.length === 1 ? variants[0] : variants.find((value) => value.variant_key === key) ?? null;
    result = matchProductIdentity(candidate, masterWithVariant(master, masterIdentifiers, variant));
  }

  if (result.decision === "AUTO_LINK") {
    for (const candidateIdentifier of item.identifiers ?? []) {
      const normalized = normalizeIdentifier(candidateIdentifier.value);
      if (!normalized) continue;
      const exists = masterIdentifiers.some((masterIdentifier) =>
        masterIdentifier.type === candidateIdentifier.type && normalizeIdentifier(masterIdentifier.value) === normalized
      );
      if (exists) continue;
      const added = await supabase.from("product_identifier").insert({
        master_product_id: masterProductId,
        identifier_type: candidateIdentifier.type,
        identifier_value: candidateIdentifier.value,
        normalized_value: normalized,
        source: sourceKey,
        is_primary: false,
      });
      if (added.error && added.error.code !== "23505") {
        throw new Error(`MASTER_IDENTIFIER_UPDATE_FAILED:${added.error.message}`);
      }
    }
  }

  const stored = await supabase.from("identity_match").upsert({
    supplier_product_id: supplierProductId,
    master_product_id: masterProductId,
    confidence: result.decision === "AUTO_LINK" ? 1 : result.decision === "REVIEW" ? 0.5 : 0,
    decision: result.decision,
    hard_block: result.decision === "BLOCK",
    hard_block_reasons: result.hardBlockReasons,
    evidence: result.evidence,
  }, { onConflict: "supplier_product_id" });
  if (stored.error) throw new Error(`IDENTITY_MATCH_UPSERT_FAILED:${stored.error.message}`);

  return { masterProductId, result };
}

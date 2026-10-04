import type { getSupabaseAdmin } from "@/lib/server/supabase";
import { matchIdentity, type IdentityIdentifier, type IdentityRecord } from "@/lib/matcher/identity";
import { planIdentityWrite, resolveIdentity, toIdentityMatchRow, type CandidateProposal, type MasterInfo, type StoredIdentityMatch } from "@/lib/matcher/identity-sync";
import {
  buildFreshnessPolicy,
  evaluateOffer,
  latestByKey,
  toNumber,
  type FreshnessPolicy,
  type MarketInput,
  type OfferEvaluation,
} from "@/lib/matcher/opportunity";
import type { IdentityDecision, Orderability } from "@/lib/matcher/gate";

type Db = ReturnType<typeof getSupabaseAdmin>;

/* Row shapes of the live Supabase schema (only the columns MATCHER reads). */
export type SupplierProductRow = {
  id: string;
  supplier_id: string;
  supplier_product_id: string;
  supplier_sku: string | null;
  brand: string | null;
  product_name: string | null;
  manufacturer: string | null;
  model_number: string | null;
  color: string | null;
  size: string | null;
  capacity: string | null;
  generation: string | null;
  set_count: number | null;
  condition: string | null;
  source_url: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};
export type SupplierOfferRow = { id: string; supplier_product_id: string; currency: string; orderability: Orderability; created_at: string; updated_at: string | null };
export type SnapshotRow = { id: string; supplier_offer_id: string; supplier_cost: number | null; shipping_cost: number | null; inventory: number | null; shipping_confidence: number | null; observed_at: string };
export type FreshnessRow = { supplier_offer_id: string; price_observed_at: string | null; inventory_observed_at: string | null; shipping_observed_at: string | null; updated_at: string | null };
export type IdentityMatchDbRow = { id: string; supplier_product_id: string; master_product_id: string | null; confidence: number; decision: IdentityDecision; hard_block: boolean; created_at: string };
export type MarketRow = Record<string, unknown> & { id: string; master_product_id: string; product_variant_id: string | null; source: string; sale_price: number; payment_fee: number | null; marketplace_fee: number | null; tax: number | null; other_cost: number | null; source_url: string | null; observed_at: string };
export type GateRow = { id: string; supplier_offer_id: string; status: "SELLABLE" | "BLOCKED"; checks: Record<string, unknown>; blocking_reasons: string[]; evaluated_at: string };
export type ProfitRow = { id: string; supplier_offer_id: string; sale_price: number; supplier_cost: number | null; shipping_cost: number | null; payment_fee: number | null; marketplace_fee: number | null; tax: number | null; other_cost: number | null; expected_profit: number | null; cost_complete: boolean; calculated_at: string };
export type MasterRow = { id: string; brand: string | null; product_name: string; manufacturer: string | null; model_number: string | null; status: string; approval_status: string };

const SUPPLIER_PRODUCT_COLUMNS = "id,supplier_id,supplier_product_id,supplier_sku,brand,product_name,manufacturer,model_number,color,size,capacity,generation,set_count,condition,source_url,first_seen_at,last_seen_at";
const CHUNK = 100;

function chunks<T>(values: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function selectIn<T>(db: Db, table: string, columns: string, column: string, values: string[], order?: { column: string; ascending: boolean }): Promise<T[]> {
  const unique = [...new Set(values.filter(Boolean))];
  const rows: T[] = [];
  for (const part of chunks(unique)) {
    let query = db.from(table).select(columns).in(column, part);
    if (order) query = query.order(order.column, { ascending: order.ascending });
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as T[]));
  }
  if (order) {
    // Chunked queries are each ordered; re-sort so "newest first" holds across chunks.
    rows.sort((a, b) => {
      const av = String((a as Record<string, unknown>)[order.column] ?? "");
      const bv = String((b as Record<string, unknown>)[order.column] ?? "");
      return order.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }
  return rows;
}

export async function fetchFreshnessPolicy(db: Db): Promise<FreshnessPolicy> {
  const { data, error } = await db.from("freshness_policy").select("*");
  if (error) throw new Error(`freshness_policy: ${error.message}`);
  return buildFreshnessPolicy((data ?? []) as Array<Record<string, unknown>>);
}

/** Latest identity_match per supplier product (newest created_at wins, any decision). */
export async function fetchLatestMatches(db: Db, supplierProductIds?: string[]): Promise<Map<string, IdentityMatchDbRow>> {
  const columns = "id,supplier_product_id,master_product_id,confidence,decision,hard_block,created_at";
  let rows: IdentityMatchDbRow[];
  if (supplierProductIds) {
    rows = await selectIn<IdentityMatchDbRow>(db, "identity_match", columns, "supplier_product_id", supplierProductIds, { column: "created_at", ascending: false });
  } else {
    const { data, error } = await db.from("identity_match").select(columns).order("created_at", { ascending: false }).limit(10000);
    if (error) throw new Error(`identity_match: ${error.message}`);
    rows = (data ?? []) as unknown as IdentityMatchDbRow[];
  }
  return latestByKey(rows, (row) => row.supplier_product_id);
}

/* ------------------------------------------------------------------ */
/* Identity matching: supplier_product → master_product (identity_match) */
/* ------------------------------------------------------------------ */

const IDENTIFIER_TYPES = new Set(["JAN", "EAN", "UPC", "MPN", "SKU", "SUPPLIER_PRODUCT_NO"]);

export type MasterCatalog = { records: IdentityRecord[]; info: Map<string, MasterInfo> };

/**
 * All masters (any status / approval) as identity candidates. Non-approved masters are
 * included so a supplier product is matched to an existing candidate instead of proposing
 * a duplicate; resolveIdentity() never AUTO_LINKs to them.
 */
export async function loadMasterCandidates(db: Db, limit = 5000): Promise<MasterCatalog> {
  const { data: masters, error } = await db
    .from("master_product")
    .select("id,brand,model_number,status,approval_status,origin_supplier_product_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`master_product: ${error.message}`);
  const masterIds = (masters ?? []).map((row) => row.id as string);
  const identifiers = await selectIn<{ master_product_id: string; identifier_type: string; identifier_value: string }>(
    db, "product_identifier", "master_product_id,identifier_type,identifier_value", "master_product_id", masterIds,
  );
  const variants = await selectIn<{ master_product_id: string; color: string | null; size: string | null; capacity: string | null; generation: string | null; set_count: number | null; condition: string | null }>(
    db, "product_variant", "master_product_id,color,size,capacity,generation,set_count,condition", "master_product_id", masterIds,
  );

  const byMaster = new Map<string, IdentityRecord>();
  const info = new Map<string, MasterInfo>();
  for (const row of masters ?? []) {
    byMaster.set(row.id as string, { id: row.id as string, brand: row.brand as string | null, modelNumber: row.model_number as string | null, identifiers: [] });
    info.set(row.id as string, {
      status: row.status as MasterInfo["status"],
      approvalStatus: (row.approval_status ?? "APPROVED") as MasterInfo["approvalStatus"],
      originSupplierProductId: (row.origin_supplier_product_id as string | null) ?? null,
    });
  }
  for (const row of identifiers) {
    const master = byMaster.get(row.master_product_id);
    if (master && IDENTIFIER_TYPES.has(row.identifier_type)) {
      master.identifiers!.push({ type: row.identifier_type as IdentityIdentifier["type"], value: row.identifier_value });
    }
  }
  const variantsByMaster = new Map<string, NonNullable<IdentityRecord["variant"]>[]>();
  for (const row of variants) {
    const list = variantsByMaster.get(row.master_product_id) ?? [];
    list.push({ color: row.color, size: row.size, capacity: row.capacity, generation: row.generation, setCount: row.set_count, condition: row.condition });
    variantsByMaster.set(row.master_product_id, list);
  }
  const records = [...byMaster.values()].flatMap((master) => {
    const list = variantsByMaster.get(master.id);
    return list?.length ? list.map((variant) => ({ ...master, variant })) : [master];
  });
  return { records, info };
}

function variantKey(variant: CandidateProposal["variant"]) {
  if (!variant) return null;
  const parts = [variant.color, variant.size, variant.capacity, variant.generation, variant.setCount != null ? `x${variant.setCount}` : null, variant.condition]
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => String(v).trim().toUpperCase());
  return parts.length ? parts.join("/") : null;
}

/**
 * Pattern B: insert a CANDIDATE master (status INACTIVE, approval CANDIDATE) from a supplier
 * product's strong identifiers. Returns null when the database refuses it (e.g. the GTIN already
 * belongs to another master): the caller then records a plain REVIEW.
 */
async function createMasterCandidate(db: Db, supplierProductId: string, proposal: CandidateProposal): Promise<string | null> {
  const master = await db.from("master_product").insert({
    product_name: proposal.productName,
    brand: proposal.brand,
    manufacturer: proposal.manufacturer,
    model_number: proposal.modelNumber,
    status: "INACTIVE",
    approval_status: "CANDIDATE",
    origin: "SUPPLIER_CANDIDATE",
    origin_supplier_product_id: supplierProductId,
  }).select("id").single();
  if (master.error) {
    if (master.error.code === "23505") return null;
    throw new Error(`master_product candidate insert: ${master.error.message}`);
  }
  const id = master.data.id as string;
  const rollback = async () => {
    const { error } = await db.from("master_product").delete().eq("id", id);
    if (error) throw new Error(`master_product candidate rollback: ${error.message}`);
  };
  if (proposal.gtins.length) {
    const ids = await db.from("product_identifier").insert(proposal.gtins.map((gtin, index) => ({
      master_product_id: id,
      identifier_type: gtin.type,
      identifier_value: gtin.value,
      normalized_value: gtin.normalized,
      source: "SUPPLIER_CANDIDATE",
      is_primary: index === 0,
    })));
    if (ids.error) {
      await rollback();
      if (ids.error.code === "23505") return null;
      throw new Error(`product_identifier candidate insert: ${ids.error.message}`);
    }
  }
  const key = variantKey(proposal.variant);
  if (key && proposal.variant) {
    const variant = await db.from("product_variant").insert({
      master_product_id: id,
      variant_key: key,
      color: proposal.variant.color ?? null,
      size: proposal.variant.size ?? null,
      capacity: proposal.variant.capacity ?? null,
      generation: proposal.variant.generation ?? null,
      set_count: proposal.variant.setCount ?? null,
      condition: proposal.variant.condition ?? null,
    });
    if (variant.error) {
      await rollback();
      throw new Error(`product_variant candidate insert: ${variant.error.message}`);
    }
  }
  return id;
}

export function supplierProductToIdentity(product: SupplierProductRow, identifiers: Array<{ identifier_type: string; identifier_value: string }>): IdentityRecord {
  const variant = {
    color: product.color,
    size: product.size,
    capacity: product.capacity,
    generation: product.generation,
    setCount: product.set_count,
    condition: product.condition,
  };
  const hasVariant = Object.values(variant).some((value) => value !== null && value !== undefined && value !== "");
  return {
    id: product.id,
    // manufacturer is not used as a brand fallback: "Sony Group" vs "SONY" would create a false conflict.
    brand: product.brand,
    modelNumber: product.model_number,
    identifiers: identifiers
      .filter((row) => IDENTIFIER_TYPES.has(row.identifier_type))
      .map((row) => ({ type: row.identifier_type as IdentityIdentifier["type"], value: row.identifier_value })),
    variant: hasVariant ? variant : null,
  };
}

export async function syncIdentityMatches(db: Db, options: { limit?: number } = {}) {
  const limit = options.limit ?? 1000;
  const { data: productRows, error } = await db
    .from("supplier_product")
    .select(SUPPLIER_PRODUCT_COLUMNS)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`supplier_product: ${error.message}`);
  const products = (productRows ?? []) as unknown as SupplierProductRow[];
  const summary = {
    evaluated: 0,
    written: 0,
    unchanged: 0,
    candidatesCreated: 0,
    decisions: { AUTO_LINK: 0, REVIEW: 0, BLOCK: 0 } as Record<string, number>,
    patterns: {} as Record<string, number>,
  };
  if (!products.length) return summary;

  const catalog = await loadMasterCandidates(db);
  const productIds = products.map((row) => row.id);
  const identifierRows = await selectIn<{ supplier_product_id: string; identifier_type: string; identifier_value: string }>(
    db, "supplier_product_identifier", "supplier_product_id,identifier_type,identifier_value", "supplier_product_id", productIds,
  );
  const identifiersByProduct = new Map<string, typeof identifierRows>();
  for (const row of identifierRows) {
    const list = identifiersByProduct.get(row.supplier_product_id) ?? [];
    list.push(row);
    identifiersByProduct.set(row.supplier_product_id, list);
  }
  const latest = await fetchLatestMatches(db, productIds);

  const inserts: Array<Record<string, unknown>> = [];
  for (const product of products) {
    summary.evaluated += 1;
    const source = { ...supplierProductToIdentity(product, identifiersByProduct.get(product.id) ?? []), productName: product.product_name, manufacturer: product.manufacturer };
    const resolution = resolveIdentity(source, catalog.records, catalog.info);
    let row = resolution.row;

    if (resolution.pattern === "B_NEW_CANDIDATE" && resolution.proposal) {
      const candidateId = await createMasterCandidate(db, product.id, resolution.proposal);
      if (candidateId) {
        summary.candidatesCreated += 1;
        // Later products in this run must see the new candidate (no duplicate proposals).
        const record: IdentityRecord = {
          id: candidateId,
          brand: resolution.proposal.brand,
          modelNumber: resolution.proposal.modelNumber,
          identifiers: resolution.proposal.gtins.map((gtin) => ({ type: gtin.type, value: gtin.value })),
          variant: resolution.proposal.variant,
        };
        catalog.records.push(record);
        catalog.info.set(candidateId, { status: "INACTIVE", approvalStatus: "CANDIDATE", originSupplierProductId: product.id });
        const evidence = matchIdentity(source, [record]);
        row = { master_product_id: candidateId, confidence: toIdentityMatchRow(evidence).confidence, decision: "REVIEW", hard_block: false };
      }
    }

    summary.patterns[resolution.pattern] = (summary.patterns[resolution.pattern] ?? 0) + 1;
    summary.decisions[row.decision] = (summary.decisions[row.decision] ?? 0) + 1;
    const prev = latest.get(product.id);
    const previous: StoredIdentityMatch | null = prev
      ? { decision: prev.decision, masterProductId: prev.master_product_id, hardBlock: prev.hard_block }
      : null;
    const write = planIdentityWrite(previous, row, { force: resolution.forceWrite });
    if (!write) {
      summary.unchanged += 1;
      continue;
    }
    inserts.push({ supplier_product_id: product.id, ...write });
  }
  for (const part of chunks(inserts)) {
    const { error: insertError } = await db.from("identity_match").insert(part);
    if (insertError) throw new Error(`identity_match insert: ${insertError.message}`);
    summary.written += part.length;
  }
  return summary;
}

/* ------------------------------------------------------------------ */
/* Offer context loading + evaluation                                   */
/* ------------------------------------------------------------------ */

export type OfferContext = {
  offer: SupplierOfferRow;
  supplierProduct: SupplierProductRow | null;
  supplierName: string | null;
  match: IdentityMatchDbRow | null;
  master: MasterRow | null;
  snapshot: SnapshotRow | null;
  freshness: FreshnessRow | null;
  market: MarketRow | null;
  latestGate: GateRow | null;
  latestProfit: ProfitRow | null;
  evaluation: OfferEvaluation;
  /** Newest observation time of any input the evaluation depends on. */
  inputsObservedAt: string | null;
};

async function latestSnapshots(db: Db, offerIds: string[]): Promise<Map<string, SnapshotRow>> {
  const out = new Map<string, SnapshotRow>();
  // Latest-per-group is not expressible in a single PostgREST call; query per offer, a few at a time.
  const ids = [...new Set(offerIds)];
  for (const part of chunks(ids, 10)) {
    const results = await Promise.all(part.map((id) => db
      .from("supplier_offer_snapshot")
      .select("id,supplier_offer_id,supplier_cost,shipping_cost,inventory,shipping_confidence,observed_at")
      .eq("supplier_offer_id", id)
      .order("observed_at", { ascending: false })
      .limit(1)));
    for (const { data, error } of results) {
      if (error) throw new Error(`supplier_offer_snapshot: ${error.message}`);
      const row = (data ?? [])[0] as SnapshotRow | undefined;
      if (row) out.set(row.supplier_offer_id, row);
    }
  }
  return out;
}

function marketInput(row: MarketRow | null): MarketInput | null {
  if (!row) return null;
  return {
    salePrice: toNumber(row.sale_price),
    paymentFee: toNumber(row.payment_fee),
    marketplaceFee: toNumber(row.marketplace_fee),
    tax: toNumber(row.tax),
    otherCost: toNumber(row.other_cost),
    // market_price_observation has no currency column in the base schema; marketplaces ingested today are JPY.
    currency: typeof row.currency === "string" && row.currency.trim() ? row.currency.trim().toUpperCase() : "JPY",
    observedAt: row.observed_at,
  };
}

function maxTimestamp(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestTime = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && time > bestTime) {
      bestTime = time;
      best = value;
    }
  }
  return best;
}

export async function loadOfferContexts(db: Db, offers: SupplierOfferRow[], options: { policy?: FreshnessPolicy; matches?: Map<string, IdentityMatchDbRow>; now?: number } = {}): Promise<OfferContext[]> {
  if (!offers.length) return [];
  const now = options.now ?? Date.now();
  const policy = options.policy ?? await fetchFreshnessPolicy(db);
  const offerIds = offers.map((row) => row.id);
  const supplierProductIds = offers.map((row) => row.supplier_product_id);

  const products = await selectIn<SupplierProductRow>(db, "supplier_product", SUPPLIER_PRODUCT_COLUMNS, "id", supplierProductIds);
  const productMap = new Map(products.map((row) => [row.id, row]));
  const suppliers = await selectIn<{ id: string; name: string }>(db, "suppliers", "id,name", "id", products.map((row) => row.supplier_id));
  const supplierMap = new Map(suppliers.map((row) => [row.id, row.name]));
  const matches = options.matches ?? await fetchLatestMatches(db, supplierProductIds);

  const masterIds = [...matches.values()].map((row) => row.master_product_id).filter((id): id is string => !!id);
  const masters = await selectIn<MasterRow>(db, "master_product", "id,brand,product_name,manufacturer,model_number,status,approval_status", "id", masterIds);
  const masterMap = new Map(masters.map((row) => [row.id, row]));

  const marketRows = await selectIn<MarketRow>(db, "market_price_observation", "*", "master_product_id", masterIds, { column: "observed_at", ascending: false });
  // Only product-level prices (no variant) are comparable with a master-level identity link.
  const marketMap = latestByKey(marketRows.filter((row) => !row.product_variant_id), (row) => row.master_product_id);

  const snapshots = await latestSnapshots(db, offerIds);
  const freshnessRows = await selectIn<FreshnessRow>(db, "supplier_offer_freshness", "supplier_offer_id,price_observed_at,inventory_observed_at,shipping_observed_at,updated_at", "supplier_offer_id", offerIds);
  const freshnessMap = new Map(freshnessRows.map((row) => [row.supplier_offer_id, row]));
  const gateRows = await selectIn<GateRow>(db, "quality_gate_result", "id,supplier_offer_id,status,checks,blocking_reasons,evaluated_at", "supplier_offer_id", offerIds, { column: "evaluated_at", ascending: false });
  const gateMap = latestByKey(gateRows, (row) => row.supplier_offer_id);
  const profitRows = await selectIn<ProfitRow>(db, "profit_snapshot", "id,supplier_offer_id,sale_price,supplier_cost,shipping_cost,payment_fee,marketplace_fee,tax,other_cost,expected_profit,cost_complete,calculated_at", "supplier_offer_id", offerIds, { column: "calculated_at", ascending: false });
  const profitMap = latestByKey(profitRows, (row) => row.supplier_offer_id);

  return offers.map((offer) => {
    const supplierProduct = productMap.get(offer.supplier_product_id) ?? null;
    const match = matches.get(offer.supplier_product_id) ?? null;
    const master = match?.master_product_id ? masterMap.get(match.master_product_id) ?? null : null;
    const snapshot = snapshots.get(offer.id) ?? null;
    const freshness = freshnessMap.get(offer.id) ?? null;
    const market = match?.master_product_id ? marketMap.get(match.master_product_id) ?? null : null;
    const evaluation = evaluateOffer({
      now,
      policy,
      match: match ? { decision: match.decision, hardBlock: !!match.hard_block, masterProductId: master ? match.master_product_id : null, masterSellable: !!master && master.status === "ACTIVE" && master.approval_status === "APPROVED", confidence: toNumber(match.confidence) ?? 0 } : null,
      offer: { orderability: offer.orderability, currency: offer.currency },
      snapshot: snapshot ? {
        supplierCost: toNumber(snapshot.supplier_cost),
        shippingCost: toNumber(snapshot.shipping_cost),
        inventory: toNumber(snapshot.inventory),
        shippingConfidence: toNumber(snapshot.shipping_confidence),
        observedAt: snapshot.observed_at,
      } : null,
      freshness: freshness ? { priceObservedAt: freshness.price_observed_at, inventoryObservedAt: freshness.inventory_observed_at, shippingObservedAt: freshness.shipping_observed_at } : null,
      market: marketInput(market),
    });
    return {
      offer,
      supplierProduct,
      supplierName: supplierProduct ? supplierMap.get(supplierProduct.supplier_id) ?? null : null,
      match,
      master,
      snapshot,
      freshness,
      market,
      latestGate: gateMap.get(offer.id) ?? null,
      latestProfit: profitMap.get(offer.id) ?? null,
      evaluation,
      inputsObservedAt: maxTimestamp([snapshot?.observed_at, market?.observed_at, match?.created_at, offer.updated_at]),
    };
  });
}

export function isAtOrAfter(a: string | null | undefined, b: string | null | undefined) {
  if (!b) return true;
  if (!a) return false;
  return new Date(a).getTime() >= new Date(b).getTime();
}

/** Re-derives the identity evidence (which identifiers / attributes agree) for display next to a candidate. */
export async function identityEvidence(db: Db, contexts: OfferContext[]) {
  const masterIds = contexts.map((ctx) => ctx.master?.id).filter((id): id is string => !!id);
  const productIds = contexts.map((ctx) => ctx.supplierProduct?.id).filter((id): id is string => !!id);
  const masterIdentifiers = await selectIn<{ master_product_id: string; identifier_type: string; identifier_value: string }>(
    db, "product_identifier", "master_product_id,identifier_type,identifier_value", "master_product_id", masterIds,
  );
  const masterVariants = await selectIn<{ master_product_id: string; color: string | null; size: string | null; capacity: string | null; generation: string | null; set_count: number | null; condition: string | null }>(
    db, "product_variant", "master_product_id,color,size,capacity,generation,set_count,condition", "master_product_id", masterIds,
  );
  const supplierIdentifiers = await selectIn<{ supplier_product_id: string; identifier_type: string; identifier_value: string }>(
    db, "supplier_product_identifier", "supplier_product_id,identifier_type,identifier_value", "supplier_product_id", productIds,
  );

  const out = new Map<string, ReturnType<typeof matchIdentity>>();
  for (const ctx of contexts) {
    if (!ctx.master || !ctx.supplierProduct) continue;
    const master = ctx.master;
    const base: IdentityRecord = {
      id: master.id,
      brand: master.brand,
      modelNumber: master.model_number,
      identifiers: masterIdentifiers
        .filter((row) => row.master_product_id === master.id && IDENTIFIER_TYPES.has(row.identifier_type))
        .map((row) => ({ type: row.identifier_type as IdentityIdentifier["type"], value: row.identifier_value })),
    };
    const variants = masterVariants.filter((row) => row.master_product_id === master.id);
    const candidates: IdentityRecord[] = variants.length
      ? variants.map((row) => ({ ...base, variant: { color: row.color, size: row.size, capacity: row.capacity, generation: row.generation, setCount: row.set_count, condition: row.condition } }))
      : [base];
    const source = supplierProductToIdentity(ctx.supplierProduct, supplierIdentifiers.filter((row) => row.supplier_product_id === ctx.supplierProduct!.id));
    out.set(ctx.offer.id, matchIdentity(source, candidates));
  }
  return out;
}

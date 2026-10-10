import { NextResponse } from "next/server";
import { hasIngestionSession, ingestionTokenConfigured } from "../../../../lib/matcher/ingestion/auth";
import { createClient } from "@supabase/supabase-js";
import { discoverShopping, type ShoppingSource } from "../../../../lib/matcher/ingestion/multi-source";
import { discoveryQueries } from "../../../../lib/matcher/ingestion/query-seeds";
import { validateSourceProduct } from "../../../../lib/matcher/ingestion/validate";
import { persistSupplierDiscovery } from "../../../../lib/matcher/ingestion/persist";
import { rankPriceSpreads } from "../../../../lib/matcher/ingestion/spread";
import { classifyProductRelevance, filterRelevantProductsWithReasons } from "../../../../lib/matcher/ingestion/relevance";
import type { SourceProduct } from "../../../../lib/matcher/ingestion/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false, code: "SUPABASE_SERVER_CREDENTIALS_NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [productsResult, suppliersResult, offersResult, snapshotsResult, identifiersResult, matchesResult] = await Promise.all([
      supabase.from("supplier_product").select("id,supplier_id,supplier_product_id,product_name,brand,model_number,color,size,capacity,generation,set_count,condition,source_url,image_url,discovery_query,last_seen_at").order("last_seen_at", { ascending: false }).limit(200),
      supabase.from("supplier").select("id,name").limit(500),
      supabase.from("supplier_offer").select("id,supplier_product_id,orderability").limit(500),
      supabase.from("supplier_offer_snapshot").select("supplier_offer_id,supplier_cost,shipping_cost,inventory,observed_at").order("observed_at", { ascending: false }).limit(4000),
      supabase.from("supplier_product_identifier").select("supplier_product_id,identifier_type,identifier_value").limit(4000),
      supabase.from("identity_match").select("supplier_product_id,master_product_id,decision,hard_block").limit(4000),
    ]);
    const failedRead = [productsResult, suppliersResult, offersResult, snapshotsResult, identifiersResult, matchesResult].find((result) => result.error);
    if (failedRead?.error) {
      const schemaCodes = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
      return NextResponse.json({
        ok: false,
        code: schemaCodes.has(failedRead.error.code ?? "") ? "DATABASE_SCHEMA_MISMATCH" : "DATABASE_READ_FAILED",
      }, { status: 502 });
    }

    const suppliers = new Map((suppliersResult.data ?? []).map((item) => [item.id, item.name]));
    const offers = new Map((offersResult.data ?? []).map((item) => [item.supplier_product_id, item]));
    const latestSnapshots = new Map<string, { supplier_offer_id: string; supplier_cost: number | string | null; shipping_cost: number | string | null; inventory: number | null; observed_at: string }>();
    for (const snapshot of snapshotsResult.data ?? []) {
      if (!latestSnapshots.has(snapshot.supplier_offer_id)) latestSnapshots.set(snapshot.supplier_offer_id, snapshot);
    }
    const identifiers = new Map<string, Array<{ type: string; value: string }>>();
    for (const identifier of identifiersResult.data ?? []) {
      const list = identifiers.get(identifier.supplier_product_id) ?? [];
      list.push({ type: identifier.identifier_type, value: identifier.identifier_value });
      identifiers.set(identifier.supplier_product_id, list);
    }
    const identityBySupplierProduct = new Map((matchesResult.data ?? []).map((match) => [match.supplier_product_id, match]));
    const masterIds = [...new Set((matchesResult.data ?? []).filter((match) => match.decision === "AUTO_LINK" && !match.hard_block && match.master_product_id).map((match) => match.master_product_id as string))];
    const mastersResult = masterIds.length
      ? await supabase.from("master_product").select("id,product_name,brand").in("id", masterIds)
      : { data: [], error: null };
    if (mastersResult.error) return NextResponse.json({ ok: false, code: "MASTER_PRODUCT_READ_FAILED" }, { status: 502 });
    const masters = new Map((mastersResult.data ?? []).map((master) => [master.id, master]));

    const sourceRows = (productsResult.data ?? []).flatMap((product) => {
      const offer = offers.get(product.id);
      if (!offer) return [];
      const snapshot = latestSnapshots.get(offer.id);
      return [{
        id: product.id,
        source: suppliers.get(product.supplier_id) ?? "unknown-source",
        sourceKey: suppliers.get(product.supplier_id) ?? "unknown-source",
        externalId: product.supplier_product_id,
        productName: product.product_name,
        brand: product.brand,
        modelNumber: product.model_number,
        color: product.color,
        size: product.size,
        capacity: product.capacity,
        generation: product.generation,
        setCount: product.set_count,
        condition: product.condition,
        discoveryQuery: product.discovery_query ?? "",
        identifiers: (identifiers.get(product.id) ?? []) as SourceProduct["identifiers"],
        cost: snapshot?.supplier_cost == null ? null : Number(snapshot.supplier_cost),
        shippingCost: snapshot?.shipping_cost == null ? null : Number(snapshot.shipping_cost),
        inventory: snapshot?.inventory ?? null,
        orderability: offer.orderability as SourceProduct["orderability"],
        sourceUrl: product.source_url,
        imageUrl: product.image_url ?? null,
        observedAt: snapshot?.observed_at ?? product.last_seen_at,
        identityDecision: identityBySupplierProduct.get(product.id)?.decision ?? "REVIEW",
        masterProductId: identityBySupplierProduct.get(product.id)?.decision === "AUTO_LINK" && !identityBySupplierProduct.get(product.id)?.hard_block
          ? identityBySupplierProduct.get(product.id)?.master_product_id ?? null
          : null,
      }];
    });

    const includedRows: typeof sourceRows = [];
    const excludedRows: Array<(typeof sourceRows)[number] & { exclusionReason: string }> = [];
    for (const product of sourceRows) {
      const decision = classifyProductRelevance(product.discoveryQuery, product);
      if (decision.relevant) includedRows.push(product);
      else excludedRows.push({ ...product, exclusionReason: decision.reason ?? "NOT_RELEVANT" });
    }

    const grouped = new Map<string, typeof includedRows>();
    for (const product of includedRows) {
      const key = product.masterProductId ? `master:${product.masterProductId}` : `supplier-product:${product.id}`;
      const group = grouped.get(key) ?? [];
      group.push(product);
      grouped.set(key, group);
    }
    const products = [...grouped.values()].map((group) => {
      const sorted = [...group].sort((a, b) => {
        if (a.cost == null) return 1;
        if (b.cost == null) return -1;
        return a.cost - b.cost;
      });
      const best = sorted[0];
      const master = best.masterProductId ? masters.get(best.masterProductId) : null;
      const uniqueIdentifiers = new Map<string, { type: string; value: string }>();
      for (const offer of group) for (const identifier of offer.identifiers ?? []) uniqueIdentifiers.set(`${identifier.type}:${identifier.value}`, identifier);
      return {
        source: best.source,
        externalId: best.externalId,
        productName: master?.product_name ?? best.productName,
        brand: master?.brand ?? best.brand,
        identifiers: [...uniqueIdentifiers.values()],
        cost: best.cost,
        shippingCost: best.shippingCost,
        inventory: best.inventory,
        orderability: best.orderability,
        sourceUrl: best.sourceUrl,
        imageUrl: best.imageUrl ?? group.find((offer) => offer.imageUrl)?.imageUrl ?? null,
        observedAt: best.observedAt,
        offerCount: group.length,
        identityDecision: group.every((offer) => offer.identityDecision === "AUTO_LINK") ? "AUTO_LINK" : "REVIEW",
      };
    });

    const spreadProducts: SourceProduct[] = includedRows.map((product) => ({
      sourceKey: product.sourceKey,
      externalId: product.externalId,
      productName: product.productName,
      brand: product.brand,
      identifiers: (product.identifiers ?? []).filter((identifier) => identifier.type === "JAN").map((identifier) => ({ type: "JAN" as const, value: identifier.value })),
      cost: product.cost,
      shippingCost: product.shippingCost,
      inventory: product.inventory,
      orderability: product.orderability,
      sourceUrl: product.sourceUrl,
    }));
    const spreads = rankPriceSpreads(spreadProducts).slice(0, 20).map((spread) => ({
      jan: spread.buy.identifiers?.find((x) => x.type === "JAN")?.value ?? null,
      buyPrice: spread.buy.cost,
      referenceSellPrice: spread.referenceSell.cost,
      grossSpread: spread.grossSpread,
      grossRoiPercent: Number(spread.grossRoiPercent.toFixed(2)),
      buySourceUrl: spread.buy.sourceUrl,
      referenceSourceUrl: spread.referenceSell.sourceUrl,
    }));
    return NextResponse.json({
      ok: true,
      mode: "stored",
      discovered: sourceRows.length,
      accepted: includedRows.length,
      rejected: excludedRows.length,
      persisted: sourceRows.length,
      displayed: products.length,
      filteredOut: excludedRows.length,
      products,
      excludedProducts: excludedRows.map((product) => ({
        source: product.source, externalId: product.externalId, productName: product.productName, brand: product.brand,
        identifiers: product.identifiers, cost: product.cost, shippingCost: product.shippingCost, inventory: product.inventory,
        orderability: product.orderability, sourceUrl: product.sourceUrl, imageUrl: product.imageUrl, observedAt: product.observedAt,
        exclusionReason: product.exclusionReason,
      })),
      spreadCandidates: spreads,
      errors: [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, code: "DISCOVERY_LIST_FAILED" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!ingestionTokenConfigured()) {
    return NextResponse.json({ ok: false, code: "INGESTION_AUTH_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!hasIngestionSession(request)) {
    return NextResponse.json({ ok: false, code: "INGESTION_AUTH_REQUIRED" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_JSON", message: "リクエスト本文は正しいJSONで指定してください。" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, code: "INVALID_BODY", message: "JSONオブジェクトが必要です。" }, { status: 400 });
  }
  const input = body as { queries?: unknown; sources?: unknown };
  if (input.queries !== undefined && (typeof input.queries !== "string" || input.queries.length > 160)) {
    return NextResponse.json({ ok: false, code: "INVALID_QUERIES", message: "検索語は160文字以内で指定してください。" }, { status: 400 });
  }
  if (input.sources !== undefined && (!Array.isArray(input.sources) || input.sources.length === 0 || input.sources.some((source) => source !== "yahoo" && source !== "rakuten"))) {
    return NextResponse.json({ ok: false, code: "INVALID_SOURCES", message: "sources は yahoo / rakuten の配列で指定してください。" }, { status: 400 });
  }
  const queries = discoveryQueries(typeof input.queries === "string" ? input.queries.trim() : undefined).slice(0, 10);
  const sources: ShoppingSource[] = input.sources === undefined ? ["yahoo", "rakuten"] : [...new Set(input.sources as ShoppingSource[])];
  if (!sources.length) return NextResponse.json({ ok: false, code: "NO_SOURCES" }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  let discovered = 0, accepted = 0, rejected = 0, persisted = 0;
  const allProducts: SourceProduct[] = [];
  const relevantProducts: SourceProduct[] = [];
  const excludedProducts: Array<SourceProduct & { exclusionReason: string }> = [];
  const errors: string[] = [];

  try {
    let queryIndex = 0;
    for (const query of queries) {
      // Yahoo documents a 1-query/second usage limit. Pace multi-query scans
      // instead of firing requests back-to-back and risking temporary blocks.
      if (queryIndex > 0 && sources.includes("yahoo")) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      queryIndex++;
      if (controller.signal.aborted) throw new DOMException("Scan timed out", "AbortError");
      const result = await discoverShopping(query, sources, controller.signal);
      discovered += result.products.length;
      allProducts.push(...result.products);
      const relevance = filterRelevantProductsWithReasons(query, result.products);
      relevantProducts.push(...relevance.included);
      excludedProducts.push(...relevance.excluded.map(({ product, reason }) => ({ ...product, exclusionReason: reason })));
      errors.push(...result.errors.map((error) => `${query}:${error}`));
      const validItems = result.products.filter((item) => validateSourceProduct(item).length === 0);
      rejected += result.products.length - validItems.length;
      accepted += validItems.length;

      // Persist in small concurrent batches. Sequentially issuing six database
      // operations per product caused 50-item scans to hit the function timeout.
      const batchSize = 5;
      for (let offset = 0; offset < validItems.length; offset += batchSize) {
        if (controller.signal.aborted) throw new DOMException("Scan timed out", "AbortError");
        const batch = validItems.slice(offset, offset + batchSize);
        const outcomes = await Promise.all(batch.map(async (item) => {
          try {
            await persistSupplierDiscovery(item.sourceKey ?? "shopping-source", item, controller.signal, query);
            return { ok: true as const };
          } catch (error) {
            return { ok: false as const, message: error instanceof Error ? error.message : "UNKNOWN" };
          }
        }));
        for (const outcome of outcomes) {
          if (outcome.ok) persisted++;
          else if (errors.length < 100) errors.push(`${query}:persist:${outcome.message}`);
        }
      }
    }
    const spreads = rankPriceSpreads(relevantProducts).slice(0, 20).map((spread) => ({
      jan: spread.buy.identifiers?.find((x) => x.type === "JAN")?.value ?? null,
      buyPrice: spread.buy.cost,
      referenceSellPrice: spread.referenceSell.cost,
      grossSpread: spread.grossSpread,
      grossRoiPercent: Number(spread.grossRoiPercent.toFixed(2)),
      buySourceUrl: spread.buy.sourceUrl,
      referenceSourceUrl: spread.referenceSell.sourceUrl,
    }));
    const products = relevantProducts.slice(0, 80).map((item) => ({
      source: item.sourceKey ?? "unknown-source",
      externalId: item.externalId,
      productName: item.productName,
      brand: item.brand ?? null,
      identifiers: item.identifiers ?? [],
      cost: item.cost ?? null,
      shippingCost: item.shippingCost ?? null,
      inventory: item.inventory ?? null,
      orderability: item.orderability ?? "UNKNOWN",
      sourceUrl: item.sourceUrl ?? null,
      imageUrl: item.imageUrl ?? null,
      observedAt: item.observedAt ?? new Date().toISOString(),
    }));
    return NextResponse.json({ ok: true, queries, sources, discovered, accepted, rejected, persisted, displayed: products.length, filteredOut: excludedProducts.length, products, excludedProducts: excludedProducts.slice(0, 100).map((product) => ({ source: product.sourceKey ?? "unknown-source", externalId: product.externalId, productName: product.productName, brand: product.brand ?? null, identifiers: product.identifiers ?? [], cost: product.cost ?? null, shippingCost: product.shippingCost ?? null, inventory: product.inventory ?? null, orderability: product.orderability ?? "UNKNOWN", sourceUrl: product.sourceUrl ?? null, imageUrl: product.imageUrl ?? null, observedAt: product.observedAt ?? null, exclusionReason: product.exclusionReason })), spreadCandidates: spreads, errors });
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    return NextResponse.json({ ok: false, code: timedOut ? "SCAN_TIMEOUT" : error instanceof Error ? error.message : "SCAN_FAILED", queries, sources, discovered, accepted, rejected, persisted, errors }, { status: timedOut ? 504 : 502 });
  } finally {
    clearTimeout(timeout);
  }
}

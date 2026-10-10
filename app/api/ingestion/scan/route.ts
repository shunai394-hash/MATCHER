import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { discoverShopping } from "../../../../lib/matcher/ingestion/multi-source";
import { discoveryQueries } from "../../../../lib/matcher/ingestion/query-seeds";
import { validateSourceProduct } from "../../../../lib/matcher/ingestion/validate";
import { persistSupplierDiscovery } from "../../../../lib/matcher/ingestion/persist";
import { rankPriceSpreads } from "../../../../lib/matcher/ingestion/spread";
import { filterRelevantProducts } from "../../../../lib/matcher/ingestion/relevance";
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
    const [productsResult, suppliersResult, offersResult, snapshotsResult, identifiersResult] = await Promise.all([
      supabase.from("supplier_product").select("id,supplier_id,supplier_product_id,product_name,brand,source_url,last_seen_at").order("last_seen_at", { ascending: false }).limit(200),
      supabase.from("supplier").select("id,name").limit(500),
      supabase.from("supplier_offer").select("id,supplier_product_id,orderability").limit(500),
      supabase.from("supplier_offer_snapshot").select("supplier_offer_id,supplier_cost,shipping_cost,inventory,observed_at").order("observed_at", { ascending: false }).limit(4000),
      supabase.from("supplier_product_identifier").select("supplier_product_id,identifier_type,identifier_value").limit(4000),
    ]);
    if ([productsResult, suppliersResult, offersResult, snapshotsResult, identifiersResult].some((result) => result.error)) {
      return NextResponse.json({ ok: false, code: "DISCOVERY_LIST_FAILED" }, { status: 502 });
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

    const products = (productsResult.data ?? []).flatMap((product) => {
      const offer = offers.get(product.id);
      if (!offer) return [];
      const snapshot = latestSnapshots.get(offer.id);
      return [{
        source: suppliers.get(product.supplier_id) ?? "unknown-source",
        externalId: product.supplier_product_id,
        productName: product.product_name,
        brand: product.brand,
        identifiers: identifiers.get(product.id) ?? [],
        cost: snapshot?.supplier_cost == null ? null : Number(snapshot.supplier_cost),
        shippingCost: snapshot?.shipping_cost == null ? null : Number(snapshot.shipping_cost),
        inventory: snapshot?.inventory ?? null,
        orderability: offer.orderability,
        sourceUrl: product.source_url,
        observedAt: snapshot?.observed_at ?? product.last_seen_at,
      }];
    });
    return NextResponse.json({ ok: true, mode: "stored", discovered: products.length, accepted: products.length, rejected: 0, persisted: products.length, products, spreadCandidates: [], errors: [] });
  } catch {
    return NextResponse.json({ ok: false, code: "DISCOVERY_LIST_FAILED" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const queries = discoveryQueries(typeof body?.queries === "string" ? body.queries : undefined).slice(0, 10);
  const sources = Array.isArray(body?.sources) ? body.sources.filter((x: unknown) => x === "yahoo" || x === "rakuten") : ["yahoo", "rakuten"];
  if (!sources.length) return NextResponse.json({ ok: false, code: "NO_SOURCES" }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  let discovered = 0, accepted = 0, rejected = 0, persisted = 0;
  const allProducts: SourceProduct[] = [];
  const relevantProducts: SourceProduct[] = [];
  const errors: string[] = [];

  try {
    for (const query of queries) {
      const result = await discoverShopping(query, sources, controller.signal);
      discovered += result.products.length;
      allProducts.push(...result.products);
      relevantProducts.push(...filterRelevantProducts(query, result.products));
      errors.push(...result.errors.map((error) => `${query}:${error}`));
      const validItems = result.products.filter((item) => validateSourceProduct(item).length === 0);
      rejected += result.products.length - validItems.length;
      accepted += validItems.length;

      // Persist in small concurrent batches. Sequentially issuing six database
      // operations per product caused 50-item scans to hit the function timeout.
      const batchSize = 5;
      for (let offset = 0; offset < validItems.length; offset += batchSize) {
        const batch = validItems.slice(offset, offset + batchSize);
        const outcomes = await Promise.all(batch.map(async (item) => {
          try {
            await persistSupplierDiscovery(item.sourceKey ?? "shopping-source", item);
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
    const spreads = rankPriceSpreads(allProducts).slice(0, 20).map((spread) => ({
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
    }));
    return NextResponse.json({ ok: true, queries, sources, discovered, accepted, rejected, persisted, displayed: products.length, filteredOut: Math.max(0, allProducts.length - relevantProducts.length), products, spreadCandidates: spreads, errors });
  } catch (error) {
    return NextResponse.json({ ok: false, code: error instanceof Error ? error.message : "SCAN_FAILED", queries, sources, discovered, accepted, rejected, persisted, errors }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

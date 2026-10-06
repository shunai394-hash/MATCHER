import { NextResponse } from "next/server";
import { discoverShopping } from "../../../../lib/matcher/ingestion/multi-source";
import { discoveryQueries } from "../../../../lib/matcher/ingestion/query-seeds";
import { validateSourceProduct } from "../../../../lib/matcher/ingestion/validate";
import { persistSupplierDiscovery } from "../../../../lib/matcher/ingestion/persist";
import { rankPriceSpreads } from "../../../../lib/matcher/ingestion/spread";
import type { SourceProduct } from "../../../../lib/matcher/ingestion/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const queries = discoveryQueries(typeof body?.queries === "string" ? body.queries : undefined).slice(0, 10);
  const sources = Array.isArray(body?.sources) ? body.sources.filter((x: unknown) => x === "yahoo" || x === "rakuten") : ["yahoo", "rakuten"];
  if (!sources.length) return NextResponse.json({ ok: false, code: "NO_SOURCES" }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  let discovered = 0, accepted = 0, rejected = 0, persisted = 0;
  const allProducts: SourceProduct[] = [];
  const errors: string[] = [];

  try {
    for (const query of queries) {
      const result = await discoverShopping(query, sources, controller.signal);
      discovered += result.products.length;
      allProducts.push(...result.products);
      errors.push(...result.errors.map((error) => `${query}:${error}`));
      for (const item of result.products) {
        if (validateSourceProduct(item).length) { rejected++; continue; }
        accepted++;
        const sourceKey = item.sourceKey ?? "shopping-source";
        try { await persistSupplierDiscovery(sourceKey, item); persisted++; }
        catch (error) { errors.push(`${query}:persist:${error instanceof Error ? error.message : "UNKNOWN"}`); }
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
    return NextResponse.json({ ok: true, queries, sources, discovered, accepted, rejected, persisted, spreadCandidates: spreads, errors });
  } catch (error) {
    return NextResponse.json({ ok: false, code: error instanceof Error ? error.message : "SCAN_FAILED", queries, sources, discovered, accepted, rejected, persisted, errors }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

import { NextResponse } from "next/server";
import { discoverShopping } from "../../../../lib/matcher/ingestion/multi-source";
import { discoveryQueries } from "../../../../lib/matcher/ingestion/query-seeds";
import { validateSourceProduct } from "../../../../lib/matcher/ingestion/validate";
import { persistSupplierDiscovery } from "../../../../lib/matcher/ingestion/persist";

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
  const errors: string[] = [];

  try {
    for (const query of queries) {
      const result = await discoverShopping(query, sources, controller.signal);
      discovered += result.products.length;
      errors.push(...result.errors.map((error) => `${query}:${error}`));
      for (const item of result.products) {
        if (validateSourceProduct(item).length) { rejected++; continue; }
        accepted++;
        const sourceKey = item.sourceUrl?.includes("shopping.yahoo.co.jp") ? "yahoo-shopping" : item.sourceUrl?.includes("rakuten.co.jp") ? "rakuten-ichiba" : "shopping-source";
        try { await persistSupplierDiscovery(sourceKey, item); persisted++; }
        catch (error) { errors.push(`${query}:persist:${error instanceof Error ? error.message : "UNKNOWN"}`); }
      }
    }
    return NextResponse.json({ ok: true, queries, sources, discovered, accepted, rejected, persisted, errors });
  } catch (error) {
    return NextResponse.json({ ok: false, code: error instanceof Error ? error.message : "SCAN_FAILED", queries, sources, discovered, accepted, rejected, persisted, errors }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

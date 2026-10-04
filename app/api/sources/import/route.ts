import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { hasOpsToken } from "@/lib/server/auth";
import { runIngestion } from "@/lib/server/ingest";
import { validateSupplierItem } from "@/lib/matcher/ingest-validation";
import { adapterFor, SourceConfigError, SourceUpstreamError, toSupplierItem } from "@/lib/sources/marketplace";

export const dynamic = "force-dynamic";

/**
 * Source → supplier_product: search eBay / 価格.com, normalize, validate, ingest (then the
 * identity → master candidate → profit → gate pipeline runs). Without credentials this fails
 * with 503 and writes nothing; it never substitutes sample data.
 */
export async function POST(request: Request) {
  if (!hasOpsToken(request)) return NextResponse.json({ error: "INGEST_AUTH_REQUIRED" }, { status: 401 });
  let body: { source?: unknown; query?: unknown; gtin?: unknown; marketplace?: unknown; limit?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const source = typeof body.source === "string" ? body.source.trim().toUpperCase() : "";
  const adapter = adapterFor(source);
  if (!adapter) return NextResponse.json({ error: "UNKNOWN_SOURCE", supported: ["EBAY", "KAKAKU"] }, { status: 400 });
  const query = typeof body.query === "string" && body.query.trim() ? body.query.trim() : undefined;
  const gtin = typeof body.gtin === "string" && /^\d{12,14}$/.test(body.gtin.trim()) ? body.gtin.trim() : undefined;
  if (!query && !gtin) return NextResponse.json({ error: "QUERY_REQUIRED" }, { status: 400 });
  const limit = typeof body.limit === "number" ? body.limit : undefined;
  const marketplace = typeof body.marketplace === "string" ? body.marketplace : undefined;

  let found;
  try {
    found = await adapter.search({ query, gtin, limit, marketplace });
  } catch (error) {
    if (error instanceof SourceConfigError) return NextResponse.json({ ok: false, error: error.code }, { status: error.code === "QUERY_REQUIRED" ? 400 : 503 });
    if (error instanceof SourceUpstreamError) return NextResponse.json({ ok: false, error: error.code, detail: error.detail ?? null }, { status: error.status });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "SOURCE_SEARCH_FAILED" }, { status: 502 });
  }

  const supplierItems = found.listings.map(toSupplierItem);
  const rejected = [...found.rejected];
  const valid = supplierItems.filter((item, index) => {
    const errors = validateSupplierItem(item, index);
    if (errors.length) rejected.push({ sourceProductId: item.supplierProductId, reason: errors.join("; ") });
    return errors.length === 0;
  });
  if (!valid.length) {
    return NextResponse.json({ ok: true, source, fetched: found.listings.length + found.rejected.length, imported: 0, rejected }, { status: 200 });
  }
  try {
    const result = await runIngestion(getSupabaseAdmin(), { source: `source:${source}`, supplierItems: valid, marketObservations: [] });
    return NextResponse.json({ ...result.body, source, fetched: found.listings.length + found.rejected.length, imported: valid.length, rejected }, { status: result.httpStatus });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "SOURCE_IMPORT_FAILED" }, { status: 500 });
  }
}

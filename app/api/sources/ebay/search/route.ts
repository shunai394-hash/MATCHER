import { NextResponse } from "next/server";
import { hasOpsToken } from "@/lib/server/auth";
import { createEbayAdapter, SourceConfigError, SourceUpstreamError } from "@/lib/sources/marketplace";

export const dynamic = "force-dynamic";

/** Read-only preview of what /api/sources/import would ingest from eBay (normalized listings + rejections). */
export async function GET(request: Request) {
  if (!hasOpsToken(request)) return NextResponse.json({ error: "INGEST_AUTH_REQUIRED" }, { status: 401 });
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || undefined;
  const gtin = url.searchParams.get("gtin")?.trim() || undefined;
  if (!query && !gtin) return NextResponse.json({ error: "QUERY_REQUIRED" }, { status: 400 });
  try {
    const result = await createEbayAdapter().search({
      query,
      gtin,
      marketplace: url.searchParams.get("marketplace") ?? "EBAY_US",
      limit: Number(url.searchParams.get("limit") ?? 20) || 20,
    });
    return NextResponse.json({ source: "EBAY", ...result });
  } catch (error) {
    if (error instanceof SourceConfigError) return NextResponse.json({ error: error.code }, { status: error.code === "QUERY_REQUIRED" ? 400 : 503 });
    if (error instanceof SourceUpstreamError) return NextResponse.json({ error: error.code, detail: error.detail ?? null }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "EBAY_SEARCH_FAILED" }, { status: 502 });
  }
}

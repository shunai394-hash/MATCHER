import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { hasOpsToken } from "@/lib/server/auth";
import { runIngestion } from "@/lib/server/ingest";
import { validateSupplierItem } from "@/lib/matcher/ingest-validation";
import { adapterFor, SourceConfigError, SourceUpstreamError, toSupplierItem } from "@/lib/sources/marketplace";
import { recomputeOpportunities } from "@/lib/server/recompute";

export const dynamic = "force-dynamic";

/** Daily proactive sourcing loop: search approved products against authorized supplier APIs, ingest validated offers, then recompute. */
export async function GET(request: Request) {
  if (!hasOpsToken(request)) return NextResponse.json({ error: "INGEST_AUTH_REQUIRED" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const limit = Math.min(25, Math.max(1, Number(process.env.MATCHER_DISCOVERY_MASTER_LIMIT ?? 10) || 10));
  const marketplaces = (process.env.MATCHER_EBAY_MARKETPLACES ?? "EBAY_US,EBAY_GB,EBAY_DE,EBAY_AU").split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
  const { data: masters, error: masterError } = await supabase.from("master_product").select("id,product_name,brand,model_number,status,approval_status").eq("status", "ACTIVE").eq("approval_status", "APPROVED").order("created_at", { ascending: false }).limit(limit);
  if (masterError) return NextResponse.json({ ok: false, error: "master_product: " + masterError.message }, { status: 500 });
  const masterIds = (masters ?? []).map((row) => row.id as string);
  const { data: ids, error: idError } = masterIds.length ? await supabase.from("product_identifier").select("master_product_id,identifier_type,identifier_value").in("master_product_id", masterIds) : { data: [], error: null };
  if (idError) return NextResponse.json({ ok: false, error: "product_identifier: " + idError.message }, { status: 500 });
  const gtinByMaster = new Map<string, string>();
  for (const row of ids ?? []) {
    if (!["JAN", "EAN", "UPC"].includes(String(row.identifier_type).toUpperCase())) continue;
    if (!gtinByMaster.has(row.master_product_id as string)) gtinByMaster.set(row.master_product_id as string, row.identifier_value as string);
  }
  const summary = { ok: true, mastersChecked: masters?.length ?? 0, searches: 0, listingsFound: 0, imported: 0, rejected: 0, sourceErrors: [] as Array<{ masterProductId: string; source: string; error: string }> };
  for (const master of masters ?? []) {
    const gtin = gtinByMaster.get(master.id as string);
    const query = [master.brand, master.model_number, master.product_name].filter((v) => typeof v === "string" && v.trim()).join(" ").trim() || undefined;
    const jobs: Array<{ source: "EBAY" | "KAKAKU"; marketplace?: string }> = [];
    if (process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) for (const marketplace of marketplaces) jobs.push({ source: "EBAY", marketplace });
    if (process.env.KAKAKU_API_BASE_URL && process.env.KAKAKU_API_TOKEN) jobs.push({ source: "KAKAKU" });
    for (const job of jobs) {
      const adapter = adapterFor(job.source);
      if (!adapter) continue;
      summary.searches += 1;
      try {
        const found = await adapter.search({ gtin, query: gtin ? undefined : query, marketplace: job.marketplace, limit: 10 });
        summary.listingsFound += found.listings.length;
        summary.rejected += found.rejected.length;
        const valid = found.listings.map(toSupplierItem).filter((item) => validateSupplierItem(item, 0).length === 0);
        if (!valid.length) continue;
        const result = await runIngestion(supabase, { source: "discovery:" + job.source + (job.marketplace ? ":" + job.marketplace : ""), supplierItems: valid, marketObservations: [] });
        if (result.httpStatus >= 400) summary.sourceErrors.push({ masterProductId: master.id as string, source: job.source, error: JSON.stringify(result.body) });
        else summary.imported += valid.length;
      } catch (error) {
        const code = error instanceof SourceConfigError || error instanceof SourceUpstreamError ? error.code : error instanceof Error ? error.message : "DISCOVERY_FAILED";
        summary.sourceErrors.push({ masterProductId: master.id as string, source: job.source + (job.marketplace ? ":" + job.marketplace : ""), error: code });
      }
    }
  }
  try {
    const recompute = await recomputeOpportunities(supabase);
    return NextResponse.json({ ...summary, recompute });
  } catch (error) {
    return NextResponse.json({ ...summary, ok: false, error: error instanceof Error ? error.message : "OPPORTUNITY_RECOMPUTE_FAILED" }, { status: 500 });
  }
}
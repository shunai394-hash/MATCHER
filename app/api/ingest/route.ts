import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { hasOpsToken } from "@/lib/server/auth";
import { runIngestion } from "@/lib/server/ingest";
import { validateBatch, type MarketObservation, type SupplierItem } from "@/lib/matcher/ingest-validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasOpsToken(request)) return NextResponse.json({ error: "INGEST_AUTH_REQUIRED" }, { status: 401 });

  let body: { source?: unknown; supplierItems?: unknown; marketObservations?: unknown; recompute?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const source = typeof body?.source === "string" ? body.source.trim() : "";
  if (!source) return NextResponse.json({ error: "SOURCE_REQUIRED" }, { status: 400 });
  if (body.supplierItems !== undefined && !Array.isArray(body.supplierItems)) return NextResponse.json({ error: "supplierItems must be an array" }, { status: 400 });
  if (body.marketObservations !== undefined && !Array.isArray(body.marketObservations)) return NextResponse.json({ error: "marketObservations must be an array" }, { status: 400 });
  const supplierItems = (body.supplierItems ?? []) as SupplierItem[];
  const marketObservations = (body.marketObservations ?? []) as MarketObservation[];
  if (!supplierItems.length && !marketObservations.length) return NextResponse.json({ error: "NOTHING_TO_INGEST" }, { status: 400 });

  // Validate everything before writing anything.
  const validationErrors = validateBatch(supplierItems, marketObservations);
  if (validationErrors.length) return NextResponse.json({ error: "VALIDATION_FAILED", details: validationErrors }, { status: 400 });

  try {
    const result = await runIngestion(getSupabaseAdmin(), { source, supplierItems, marketObservations, recompute: body.recompute !== false });
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "INGEST_FAILED" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { recomputeOpportunities } from "@/lib/server/recompute";
import { hasOpsToken } from "@/lib/server/auth";

// Ops token, or Vercel Cron (`Authorization: Bearer $CRON_SECRET`).

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  if (!hasOpsToken(request)) return NextResponse.json({ error: "INGEST_AUTH_REQUIRED" }, { status: 401 });
  try {
    return NextResponse.json(await recomputeOpportunities(getSupabaseAdmin()));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "OPPORTUNITY_RECOMPUTE_FAILED" }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;

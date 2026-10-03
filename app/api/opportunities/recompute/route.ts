import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { recomputeOpportunities } from "@/lib/server/recompute";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const ingestToken = process.env.MATCHER_INGEST_TOKEN;
  if (ingestToken && request.headers.get("x-matcher-ingest-token") === ingestToken) return true;
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
  const cronSecret = process.env.CRON_SECRET;
  return !!cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "INGEST_AUTH_REQUIRED" }, { status: 401 });
  try {
    return NextResponse.json(await recomputeOpportunities(getSupabaseAdmin()));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "OPPORTUNITY_RECOMPUTE_FAILED" }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;

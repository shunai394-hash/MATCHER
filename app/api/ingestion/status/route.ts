import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ingestionConfiguration } from "../../../../lib/matcher/ingestion/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let feePolicy: { configured: boolean; status: "CONFIGURED" | "MISSING" | "UNAVAILABLE" } = {
    configured: false,
    status: "UNAVAILABLE",
  };
  if (url && serviceKey) {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await supabase.from("profit_fee_policy").select("id", { count: "exact", head: true }).eq("active", true);
    feePolicy = result.error
      ? { configured: false, status: "UNAVAILABLE" }
      : { configured: (result.count ?? 0) > 0, status: (result.count ?? 0) > 0 ? "CONFIGURED" : "MISSING" };
  }
  return NextResponse.json({
    ok: true,
    ...ingestionConfiguration(),
    feePolicy,
  }, { headers: { "Cache-Control": "no-store" } });
}

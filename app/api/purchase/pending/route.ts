import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { getAuthUser, hasReviewToken } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasReviewToken(request) && !(await getAuthUser(request))?.roles.has("purchaser")) {
    return NextResponse.json({ error: "REVIEW_AUTH_REQUIRED" }, { status: 401 });
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("purchase_review")
    .select("id,master_product_id,supplier_offer_id,amount,currency,status,decision_snapshot,verified_terms,requested_by_email,created_at")
    .eq("status", "AWAITING_HUMAN")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reviews: data ?? [] });
}

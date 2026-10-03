import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
export async function GET(request: Request) {
  if (!process.env.MATCHER_REVIEW_TOKEN || request.headers.get("x-matcher-review-token") !== process.env.MATCHER_REVIEW_TOKEN) return NextResponse.json({ error: "REVIEW_AUTH_REQUIRED" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("purchase_review").select("id,master_product_id,supplier_offer_id,amount,currency,status,decision_snapshot,created_at").eq("status","AWAITING_HUMAN").order("created_at",{ascending:true}).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reviews: data ?? [] });
}

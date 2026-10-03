import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { capturePaymentIntent, cancelPaymentIntent } from "@/lib/server/stripe";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { reviewId?: string; action?: "approve" | "reject"; reason?: string };
    if (!body.reviewId || !body.action) {
      return NextResponse.json({ error: "REVIEW_INPUT_REQUIRED" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: review, error } = await supabase
      .from("purchase_review")
      .select("id,status,amount,currency,stripe_payment_intent_id")
      .eq("id", body.reviewId)
      .single();
    if (error || !review) return NextResponse.json({ error: "PURCHASE_REVIEW_NOT_FOUND" }, { status: 404 });
    if (review.status !== "AWAITING_HUMAN") {
      return NextResponse.json({ error: "PURCHASE_NOT_AWAITING_HUMAN", status: review.status }, { status: 409 });
    }
    if (!review.stripe_payment_intent_id) {
      return NextResponse.json({ error: "PAYMENT_INTENT_MISSING" }, { status: 409 });
    }

    if (body.action === "approve") {
      const captured = await capturePaymentIntent(review.stripe_payment_intent_id);
      const { error: updateError } = await supabase.from("purchase_review").update({
        status: "APPROVED",
        reviewed_at: new Date().toISOString(),
        captured_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", review.id);
      if (updateError) throw updateError;
      return NextResponse.json({ reviewId: review.id, status: "APPROVED", paymentStatus: captured.status });
    }

    await cancelPaymentIntent(review.stripe_payment_intent_id);
    const { error: updateError } = await supabase.from("purchase_review").update({
      status: "REJECTED",
      rejection_reason: body.reason?.trim() || "HUMAN_REJECTED",
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", review.id);
    if (updateError) throw updateError;
    return NextResponse.json({ reviewId: review.id, status: "REJECTED" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PURCHASE_REVIEW_FAILED" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { capturePaymentIntent, cancelPaymentIntent } from "@/lib/server/stripe";
import { getAuthUser, hasReviewToken } from "@/lib/server/auth";
import { verifyPurchase } from "@/lib/server/purchase";

export const dynamic = "force-dynamic";

async function reviewer(request: Request) {
  if (hasReviewToken(request)) return { ok: true as const, by: "review-token" };
  const user = await getAuthUser(request);
  if (user?.roles.has("purchaser")) return { ok: true as const, by: user.email ?? user.id };
  return { ok: false as const };
}

export async function POST(request: Request) {
  try {
    const who = await reviewer(request);
    if (!who.ok) return NextResponse.json({ error: "REVIEW_AUTH_REQUIRED" }, { status: 401 });
    const body = await request.json() as { reviewId?: string; action?: "approve" | "reject"; reason?: string };
    if (!body.reviewId || (body.action !== "approve" && body.action !== "reject")) return NextResponse.json({ error: "REVIEW_INPUT_REQUIRED" }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { data: review, error } = await supabase
      .from("purchase_review")
      .select("id,status,amount,currency,master_product_id,supplier_offer_id,stripe_payment_intent_id,verified_terms")
      .eq("id", body.reviewId)
      .maybeSingle();
    if (error) throw error;
    if (!review) return NextResponse.json({ error: "PURCHASE_REVIEW_NOT_FOUND" }, { status: 404 });
    if (review.status !== "AWAITING_HUMAN") return NextResponse.json({ error: "PURCHASE_NOT_AWAITING_HUMAN", status: review.status }, { status: 409 });
    if (!review.stripe_payment_intent_id) return NextResponse.json({ error: "PAYMENT_INTENT_MISSING" }, { status: 409 });

    if (body.action === "approve") {
      // Re-verify on the newest data right before capture: stock, price, shipping, freshness,
      // identity, gate and profit may have changed since the card was authorized.
      const authorizedTerms = (review.verified_terms ?? {}) as { amount?: number; expectedProfit?: number };
      if (!review.master_product_id || !review.supplier_offer_id || typeof authorizedTerms.amount !== "number") {
        return NextResponse.json({ error: "PURCHASE_TERMS_MISSING" }, { status: 409 });
      }
      const check = await verifyPurchase(supabase, {
        masterProductId: review.master_product_id,
        supplierOfferId: review.supplier_offer_id,
        approved: { amount: authorizedTerms.amount, expectedProfit: authorizedTerms.expectedProfit ?? null },
      });
      if (!check.ok) {
        return NextResponse.json({ error: "PURCHASE_REVERIFICATION_FAILED", cause: check.error, reasons: check.reasons ?? [], current: check.current ?? null }, { status: 409 });
      }
      if (check.terms.amountMinor !== Number(review.amount)) {
        return NextResponse.json({ error: "PURCHASE_REVERIFICATION_FAILED", cause: "AMOUNT_CHANGED" }, { status: 409 });
      }
      const captured = await capturePaymentIntent(review.stripe_payment_intent_id);
      const now = new Date().toISOString();
      const { error: updateError } = await supabase.from("purchase_review").update({ status: "APPROVED", reviewed_at: now, captured_at: now, updated_at: now, verified_terms: { ...check.terms, capturedBy: who.by } }).eq("id", review.id);
      if (updateError) throw updateError;
      return NextResponse.json({ reviewId: review.id, status: "APPROVED", paymentStatus: captured.status });
    }
    await cancelPaymentIntent(review.stripe_payment_intent_id);
    const { error: updateError } = await supabase.from("purchase_review").update({ status: "REJECTED", rejection_reason: body.reason?.trim() || "HUMAN_REJECTED", reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", review.id);
    if (updateError) throw updateError;
    return NextResponse.json({ reviewId: review.id, status: "REJECTED" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PURCHASE_REVIEW_FAILED" }, { status: 500 });
  }
}

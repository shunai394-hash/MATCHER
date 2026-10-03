import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { createManualCaptureCheckout } from "@/lib/server/stripe";
import { requireUserRole } from "@/lib/server/auth";
import { isUuid, verifyPurchase } from "@/lib/server/purchase";

export const dynamic = "force-dynamic";

/**
 * Opportunity → human approval (this request, by an authenticated purchaser) →
 * server re-verification on the newest data → Stripe manual-capture authorization.
 * Capture happens later, only after a second human review that re-verifies again.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireUserRole(request, "purchaser");
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    let body: { masterProductId?: unknown; supplierOfferId?: unknown; approved?: { amount?: unknown; expectedProfit?: unknown }; note?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
    }
    if (!body.masterProductId || !body.supplierOfferId) return NextResponse.json({ error: "PURCHASE_TARGET_REQUIRED" }, { status: 400 });
    if (!isUuid(body.masterProductId) || !isUuid(body.supplierOfferId)) return NextResponse.json({ error: "PURCHASE_TARGET_INVALID" }, { status: 400 });
    const amount = body.approved?.amount;
    const expectedProfit = body.approved?.expectedProfit;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "APPROVED_TERMS_REQUIRED", detail: "approved.amount (supplier cost + shipping the user approved) is required" }, { status: 400 });
    }
    if (expectedProfit != null && (typeof expectedProfit !== "number" || !Number.isFinite(expectedProfit))) {
      return NextResponse.json({ error: "APPROVED_TERMS_INVALID" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const check = await verifyPurchase(supabase, {
      masterProductId: body.masterProductId,
      supplierOfferId: body.supplierOfferId,
      approved: { amount, expectedProfit: expectedProfit as number | null | undefined },
    });
    if (!check.ok) return NextResponse.json({ error: check.error, reasons: check.reasons ?? [], current: check.current ?? null }, { status: check.status });
    const { terms } = check;

    const { data: review, error } = await supabase
      .from("purchase_review")
      .insert({
        master_product_id: terms.masterProductId,
        supplier_offer_id: terms.supplierOfferId,
        amount: terms.amountMinor,
        currency: terms.currency,
        status: "AUTHORIZING",
        // Server-verified facts only; the client's note is kept separately and never trusted as data.
        decision_snapshot: { note: typeof body.note === "string" ? body.note.slice(0, 500) : null },
        verified_terms: terms,
        requested_by_user_id: auth.user.id,
        requested_by_email: auth.user.email,
        authorized_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;

    const origin = new URL(request.url).origin;
    let session: Awaited<ReturnType<typeof createManualCaptureCheckout>>;
    try {
      session = await createManualCaptureCheckout({
        amount: terms.amountMinor,
        currency: terms.currency,
        purchaseReviewId: review.id,
        successUrl: `${origin}/review?purchase_review=${review.id}&payment=authorized`,
        cancelUrl: `${origin}/opportunities?purchase_review=${review.id}&payment=cancelled`,
      });
    } catch (stripeError) {
      // Do not leave a review stuck in AUTHORIZING when no checkout exists.
      const { error: failError } = await supabase.from("purchase_review").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", review.id);
      if (failError) throw failError;
      throw stripeError;
    }

    const { error: updateError } = await supabase
      .from("purchase_review")
      .update({
        status: "AWAITING_HUMAN",
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", review.id);
    if (updateError) throw updateError;

    return NextResponse.json({ reviewId: review.id, checkoutUrl: session.url, status: "AWAITING_HUMAN", terms });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PURCHASE_AUTHORIZATION_FAILED" }, { status: 500 });
  }
}

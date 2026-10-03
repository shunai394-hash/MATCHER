import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { createManualCaptureCheckout } from "@/lib/server/stripe";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      masterProductId?: string | null;
      supplierOfferId?: string | null;
      amount?: number;
      currency?: string;
      decisionSnapshot?: Record<string, unknown>;
    };

    if (!Number.isInteger(body.amount) || (body.amount ?? 0) <= 0) {
      return NextResponse.json({ error: "INVALID_PURCHASE_AMOUNT" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: review, error } = await supabase
      .from("purchase_review")
      .insert({
        master_product_id: body.masterProductId ?? null,
        supplier_offer_id: body.supplierOfferId ?? null,
        amount: body.amount,
        currency: (body.currency ?? "jpy").toLowerCase(),
        status: "AUTHORIZING",
        decision_snapshot: body.decisionSnapshot ?? {},
      })
      .select("id")
      .single();
    if (error) throw error;

    const origin = new URL(request.url).origin;
    const session = await createManualCaptureCheckout({
      amount: body.amount,
      currency: body.currency ?? "jpy",
      purchaseReviewId: review.id,
      successUrl: `${origin}/console?purchase_review=${review.id}&payment=authorized`,
      cancelUrl: `${origin}/console?purchase_review=${review.id}&payment=cancelled`,
    });

    const { error: updateError } = await supabase
      .from("purchase_review")
      .update({
        status: "AWAITING_HUMAN",
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      })
      .eq("id", review.id);
    if (updateError) throw updateError;

    return NextResponse.json({ reviewId: review.id, checkoutUrl: session.url, status: "AWAITING_HUMAN" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PURCHASE_AUTHORIZATION_FAILED" },
      { status: 500 },
    );
  }
}

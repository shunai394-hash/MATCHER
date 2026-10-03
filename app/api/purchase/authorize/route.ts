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

    if (!body.masterProductId || !body.supplierOfferId) {
      return NextResponse.json({ error: "PURCHASE_TARGET_REQUIRED" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: offer, error: offerError } = await supabase
      .from("supplier_offer")
      .select("id,supplier_product_id,orderability,currency")
      .eq("id", body.supplierOfferId)
      .single();
    if (offerError || !offer || offer.orderability !== "ORDERABLE") {
      return NextResponse.json({ error: "OFFER_NOT_ORDERABLE" }, { status: 409 });
    }

    const { data: link, error: linkError } = await supabase
      .from("identity_match")
      .select("master_product_id,decision")
      .eq("master_product_id", body.masterProductId)
      .eq("supplier_product_id", offer.supplier_product_id)
      .eq("decision", "AUTO_LINK")
      .limit(1)
      .maybeSingle();
    if (linkError || !link) {
      return NextResponse.json({ error: "IDENTITY_LINK_NOT_CONFIRMED" }, { status: 409 });
    }

    const { data: snapshot, error: snapshotError } = await supabase
      .from("supplier_offer_snapshot")
      .select("supplier_cost,shipping_cost,inventory")
      .eq("supplier_offer_id", offer.id)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshotError || !snapshot || snapshot.supplier_cost == null || snapshot.shipping_cost == null) {
      return NextResponse.json({ error: "PURCHASE_COST_DATA_MISSING" }, { status: 409 });
    }
    if (snapshot.inventory == null || snapshot.inventory <= 0) {
      return NextResponse.json({ error: "PURCHASE_INVENTORY_UNAVAILABLE" }, { status: 409 });
    }

    const amount = Math.round(Number(snapshot.supplier_cost) + Number(snapshot.shipping_cost));
    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: "INVALID_PURCHASE_AMOUNT" }, { status: 409 });
    }
    const { data: review, error } = await supabase
      .from("purchase_review")
      .insert({
        master_product_id: body.masterProductId ?? null,
        supplier_offer_id: body.supplierOfferId ?? null,
        amount,
        currency: (offer.currency ?? body.currency ?? "jpy").toLowerCase(),
        status: "AUTHORIZING",
        decision_snapshot: body.decisionSnapshot ?? {},
      })
      .select("id")
      .single();
    if (error) throw error;

    const origin = new URL(request.url).origin;
    const session = await createManualCaptureCheckout({
      amount,
      currency: offer.currency ?? body.currency ?? "jpy",
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

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { createManualCaptureCheckout, toStripeMinorUnits } from "@/lib/server/stripe";
import { checkFreshness } from "@/lib/matcher/opportunity";
import { fetchFreshnessPolicy } from "@/lib/server/matcher-data";

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
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(body.masterProductId) || !uuid.test(body.supplierOfferId)) {
      return NextResponse.json({ error: "PURCHASE_TARGET_INVALID" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: offer, error: offerError } = await supabase
      .from("supplier_offer")
      .select("id,supplier_product_id,orderability,currency")
      .eq("id", body.supplierOfferId)
      .single();
    if (offerError && offerError.code !== "PGRST116") throw offerError;
    if (!offer || offer.orderability !== "ORDERABLE") {
      return NextResponse.json({ error: "OFFER_NOT_ORDERABLE" }, { status: 409 });
    }

    // The newest identity decision for this supplier product must be an un-blocked AUTO_LINK to this master.
    const { data: link, error: linkError } = await supabase
      .from("identity_match")
      .select("master_product_id,decision,hard_block,created_at")
      .eq("supplier_product_id", offer.supplier_product_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link || link.decision !== "AUTO_LINK" || link.hard_block || link.master_product_id !== body.masterProductId) {
      return NextResponse.json({ error: "IDENTITY_LINK_NOT_CONFIRMED" }, { status: 409 });
    }

    const { data: snapshot, error: snapshotError } = await supabase
      .from("supplier_offer_snapshot")
      .select("supplier_cost,shipping_cost,inventory")
      .eq("supplier_offer_id", offer.id)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshotError) throw snapshotError;
    if (!snapshot || snapshot.supplier_cost == null || snapshot.shipping_cost == null) {
      return NextResponse.json({ error: "PURCHASE_COST_DATA_MISSING" }, { status: 409 });
    }
    if (snapshot.inventory == null || snapshot.inventory <= 0) {
      return NextResponse.json({ error: "PURCHASE_INVENTORY_UNAVAILABLE" }, { status: 409 });
    }

    const { data: freshness, error: freshnessError } = await supabase
      .from("supplier_offer_freshness")
      .select("price_observed_at,inventory_observed_at,shipping_observed_at")
      .eq("supplier_offer_id", offer.id)
      .maybeSingle();
    if (freshnessError) throw freshnessError;
    if (!freshness) {
      return NextResponse.json({ error: "PURCHASE_FRESHNESS_DATA_MISSING" }, { status: 409 });
    }
    const policy = await fetchFreshnessPolicy(supabase);
    const now = Date.now();
    if (!checkFreshness(freshness.price_observed_at, "PRICE", policy, now).fresh ||
        !checkFreshness(freshness.inventory_observed_at, "INVENTORY", policy, now).fresh ||
        !checkFreshness(freshness.shipping_observed_at, "SHIPPING", policy, now).fresh) {
      return NextResponse.json({ error: "PURCHASE_OFFER_DATA_STALE" }, { status: 409 });
    }

    const currency = (offer.currency ?? "JPY").toLowerCase();
    const amount = toStripeMinorUnits(Number(snapshot.supplier_cost) + Number(snapshot.shipping_cost), currency);
    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: "INVALID_PURCHASE_AMOUNT" }, { status: 409 });
    }
    const { data: review, error } = await supabase
      .from("purchase_review")
      .insert({
        master_product_id: body.masterProductId ?? null,
        supplier_offer_id: body.supplierOfferId ?? null,
        amount,
        currency,
        status: "AUTHORIZING",
        decision_snapshot: body.decisionSnapshot ?? {},
        authorized_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;

    const origin = new URL(request.url).origin;
    let session: Awaited<ReturnType<typeof createManualCaptureCheckout>>;
    try {
      session = await createManualCaptureCheckout({
        amount,
        currency,
        purchaseReviewId: review.id,
        successUrl: `${origin}/console?purchase_review=${review.id}&payment=authorized`,
        cancelUrl: `${origin}/console?purchase_review=${review.id}&payment=cancelled`,
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

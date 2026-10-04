import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/server/supabase";

function verifyStripeSignature(payload: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const parts = signature.split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const v1 = parts.find(([key]) => key === "v1")?.[1];
  if (!timestamp || !v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "STRIPE_WEBHOOK_CONFIG_MISSING" }, { status: 500 });
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "STRIPE_SIGNATURE_INVALID" }, { status: 400 });
  }

  try {
    const event = JSON.parse(payload) as { type?: string; data?: { object?: Record<string, unknown> } };
    const object = event.data?.object ?? {};
    const metadata = object.metadata as Record<string, unknown> | undefined;
    const reviewId = typeof metadata?.purchase_review_id === "string" ? metadata.purchase_review_id : null;
    const paymentIntentId = typeof object.id === "string" && object.id.startsWith("pi_") ? object.id : null;
    if (!reviewId && !paymentIntentId) return NextResponse.json({ received: true });

    const supabase = getSupabaseAdmin();
    let query = supabase.from("purchase_review").select("id,status").limit(1);
    if (reviewId) query = query.eq("id", reviewId);
    else query = query.eq("stripe_payment_intent_id", paymentIntentId);
    const { data: review, error } = await query.maybeSingle();
    if (error) throw error;
    if (!review) return NextResponse.json({ received: true });

    const now = new Date().toISOString();
    let update: Record<string, unknown> | null = null;
    if (event.type === "payment_intent.amount_capturable_updated" && review.status === "AUTHORIZING") {
      update = { status: "AWAITING_HUMAN", updated_at: now };
    } else if (event.type === "payment_intent.payment_failed" && !["APPROVED","REJECTED"].includes(review.status)) {
      update = { status: "FAILED", updated_at: now };
    } else if (event.type === "payment_intent.canceled" && !["APPROVED","REJECTED"].includes(review.status)) {
      update = { status: "EXPIRED", updated_at: now };
    } else if (event.type === "payment_intent.succeeded" && review.status === "AWAITING_HUMAN") {
      update = { status: "APPROVED", captured_at: now, reviewed_at: now, updated_at: now };
    }
    if (update) {
      // Fail loudly so Stripe retries the event instead of silently losing a state transition.
      const { error: updateError } = await supabase.from("purchase_review").update(update).eq("id", review.id);
      if (updateError) throw updateError;
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "STRIPE_WEBHOOK_FAILED" }, { status: 500 });
  }
}

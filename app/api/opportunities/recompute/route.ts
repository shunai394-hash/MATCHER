import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";

function authorized(request: Request) {
  const token = process.env.MATCHER_INGEST_TOKEN;
  return !!token && request.headers.get("x-matcher-ingest-token") === token;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "INGEST_AUTH_REQUIRED" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  try {
    const { data: observations, error: observationError } = await supabase
      .from("market_price_observation")
      .select("master_product_id,product_variant_id,sale_price,payment_fee,marketplace_fee,tax,other_cost,observed_at")
      .order("observed_at", { ascending: false })
      .limit(1000);
    if (observationError) throw observationError;

    const latestMarket = new Map<string, (typeof observations)[number]>();
    for (const row of observations ?? []) {
      const key = row.master_product_id + ":" + (row.product_variant_id ?? "");
      if (!latestMarket.has(key)) latestMarket.set(key, row);
    }

    const { data: matches, error: matchError } = await supabase
      .from("identity_match")
      .select("supplier_product_id,master_product_id,confidence,decision,created_at")
      .eq("decision", "AUTO_LINK")
      .eq("hard_block", false)
      .not("master_product_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (matchError) throw matchError;

    const latestMatch = new Map<string, (typeof matches)[number]>();
    for (const row of matches ?? []) if (!latestMatch.has(row.supplier_product_id)) latestMatch.set(row.supplier_product_id, row);

    const productIds = [...latestMatch.keys()];
    if (!productIds.length) return NextResponse.json({ ok: true, generated: 0, reason: "NO_AUTO_LINKED_PRODUCTS" });

    const { data: offers, error: offerError } = await supabase
      .from("supplier_offer")
      .select("id,supplier_product_id,currency,orderability")
      .in("supplier_product_id", productIds)
      .eq("orderability", "ORDERABLE");
    if (offerError) throw offerError;

    let generated = 0;
    for (const offer of offers ?? []) {
      const { data: snapshots, error: snapshotError } = await supabase.from("supplier_offer_snapshot").select("supplier_cost,shipping_cost,inventory,observed_at").eq("supplier_offer_id", offer.id).order("observed_at", { ascending: false }).limit(1);
      if (snapshotError) throw snapshotError;
      const snapshot = snapshots?.[0];
      if (snapshot?.supplier_cost == null || snapshot?.shipping_cost == null || snapshot?.inventory == null || snapshot.inventory <= 0) continue;
      const match = latestMatch.get(offer.supplier_product_id);
      if (!match?.master_product_id) continue;
      const market = latestMarket.get(match.master_product_id + ":");
      if (!market) continue;
      if (market.payment_fee == null || market.marketplace_fee == null || market.tax == null || market.other_cost == null) continue;

      const expectedProfit =
        Number(market.sale_price) -
        Number(snapshot.supplier_cost) -
        Number(snapshot.shipping_cost) -
        Number(market.payment_fee) -
        Number(market.marketplace_fee) -
        Number(market.tax) -
        Number(market.other_cost);

      const snapshot = await supabase.from("profit_snapshot").insert({
        supplier_offer_id: offer.id,
        sale_price: market.sale_price,
        supplier_cost: snapshot.supplier_cost,
        shipping_cost: snapshot.shipping_cost,
        payment_fee: market.payment_fee,
        marketplace_fee: market.marketplace_fee,
        tax: market.tax,
        other_cost: market.other_cost,
        expected_profit: expectedProfit,
        calculated_at: new Date().toISOString(),
        cost_complete: true,
      });
      if (snapshot.error) throw snapshot.error;

      const gate = await supabase.from("quality_gate_result").insert({
        supplier_offer_id: offer.id,
        status: expectedProfit > 0 ? "SELLABLE" : "BLOCKED",
        checks: {
          identity: "AUTO_LINK",
          inventory: "AVAILABLE",
          profit: expectedProfit > 0 ? "POSITIVE" : "NON_POSITIVE",
        },
        blocking_reasons: expectedProfit > 0 ? [] : ["EXPECTED_PROFIT_NON_POSITIVE"],
      });
      if (gate.error) throw gate.error;
      generated += 1;
    }

    return NextResponse.json({ ok: true, generated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "OPPORTUNITY_RECOMPUTE_FAILED" }, { status: 500 });
  }
}

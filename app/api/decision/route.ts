import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { matchIdentity, type IdentityRecord } from "@/lib/matcher/identity";
import { calculateExpectedProfit, evaluateSellability } from "@/lib/matcher/gate";

type Body = {
  brand?: string;
  modelNumber?: string;
  jan?: string;
  ean?: string;
  upc?: string;
  color?: string;
  size?: string;
  capacity?: string;
  generation?: string;
  setCount?: number | null;
  condition?: string;
  salePrice?: number | null;
};

function clean(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const supabase = getSupabaseAdmin();

    const identifiers = [
      ["JAN", clean(body.jan)],
      ["EAN", clean(body.ean)],
      ["UPC", clean(body.upc)],
    ].filter(([, value]) => value) as Array<["JAN" | "EAN" | "UPC", string]>;

    const { data: masters, error } = await supabase
      .from("master_product")
      .select("id,brand,model_number,product_name")
      .eq("status", "ACTIVE")
      .limit(100);

    if (error) throw error;

    const masterIds = (masters ?? []).map((row) => row.id);
    const { data: masterIdentifiers, error: idError } = masterIds.length
      ? await supabase.from("product_identifier")
          .select("master_product_id,identifier_type,identifier_value")
          .in("master_product_id", masterIds)
      : { data: [], error: null };

    if (idError) throw idError;

    const byMaster = new Map<string, IdentityRecord>();
    for (const row of masters ?? []) {
      byMaster.set(row.id, {
        id: row.id,
        brand: row.brand,
        modelNumber: row.model_number,
        identifiers: [],
      });
    }

    for (const row of masterIdentifiers ?? []) {
      const master = byMaster.get(row.master_product_id);
      if (master) {
        master.identifiers = [
          ...(master.identifiers ?? []),
          { type: row.identifier_type, value: row.identifier_value },
        ];
      }
    }

    const source: IdentityRecord = {
      id: "customer-input",
      brand: clean(body.brand) || null,
      modelNumber: clean(body.modelNumber) || null,
      identifiers,
      variant: {
        color: clean(body.color) || null,
        size: clean(body.size) || null,
        capacity: clean(body.capacity) || null,
        generation: clean(body.generation) || null,
        setCount: body.setCount ?? null,
        condition: clean(body.condition) || null,
      },
    };

    const identity = matchIdentity(source, [...byMaster.values()]);
    let profitability = null;
    let sellability = null;

    if (identity.masterProductId && body.salePrice != null) {
      const { data: offers, error: offerError } = await supabase
        .from("supplier_offer")
        .select("id,supplier_product_id,orderability,currency")
        .limit(100);

      if (offerError) throw offerError;

      const matchedOffers = (offers ?? []).filter((offer) => offer.orderability === "ORDERABLE");
      if (matchedOffers.length > 0) {
        const offer = matchedOffers[0];
        const { data: snapshots } = await supabase
          .from("supplier_offer_snapshot")
          .select("supplier_cost,shipping_cost,observed_at")
          .eq("supplier_offer_id", offer.id)
          .order("observed_at", { ascending: false })
          .limit(1);

        const snapshot = snapshots?.[0];
        profitability = calculateExpectedProfit({
          salePrice: body.salePrice,
          supplierCost: snapshot?.supplier_cost ?? null,
          shippingCost: snapshot?.shipping_cost ?? null,
          paymentFee: null,
          marketplaceFee: null,
          tax: null,
          otherCost: null,
        });

        sellability = evaluateSellability({
          identityDecision: identity.decision,
          hardBlockReasons: identity.reasons.filter((r) => r.includes("CONFLICT") || r.includes("VARIANT")),
          orderability: offer.orderability,
          inventoryKnown: snapshot?.observed_at != null,
          inventoryFresh: snapshot?.observed_at != null,
          priceKnown: snapshot?.supplier_cost != null,
          priceFresh: snapshot?.observed_at != null,
          supplierCost: snapshot?.supplier_cost ?? null,
          shippingCost: snapshot?.shipping_cost ?? null,
          requiredFeesKnown: profitability.complete,
          expectedProfit: profitability.expectedProfit,
          profitCurrency: offer.currency ?? "JPY",
        });
      }
    }

    return NextResponse.json({
      decision: identity,
      profitability,
      sellability,
      candidateCount: byMaster.size,
      source,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "DECISION_FAILED" },
      { status: 500 },
    );
  }
}

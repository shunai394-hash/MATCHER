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
      const { data: links, error: linkError } = await supabase
        .from("identity_match")
        .select("supplier_product_id,confidence,decision")
        .eq("master_product_id", identity.masterProductId)
        .eq("decision", "AUTO_LINK")
        .order("confidence", { ascending: false })
        .limit(20);
      if (linkError) throw linkError;

      const supplierProductIds = (links ?? []).map((link) => link.supplier_product_id);
      const { data: offers, error: offerError } = supplierProductIds.length
        ? await supabase
            .from("supplier_offer")
            .select("id,supplier_product_id,orderability,currency")
            .in("supplier_product_id", supplierProductIds)
        : { data: [], error: null };
      if (offerError) throw offerError;

      const matchedOffers = (offers ?? []).filter((offer) => offer.orderability === "ORDERABLE");
      if (matchedOffers.length > 0) {
        const offer = matchedOffers[0];
        const { data: snapshots, error: snapshotError } = await supabase
          .from("supplier_offer_snapshot")
          .select("supplier_cost,shipping_cost,inventory,observed_at")
          .eq("supplier_offer_id", offer.id)
          .order("observed_at", { ascending: false })
          .limit(1);
        if (snapshotError) throw snapshotError;

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

        const observedAt = snapshot?.observed_at ? new Date(snapshot.observed_at).getTime() : 0;
        const ageSeconds = observedAt ? Math.max(0, (Date.now() - observedAt) / 1000) : Infinity;
        const { data: policies } = await supabase
          .from("freshness_policy")
          .select("data_type,max_age_seconds");
        const policyMap = new Map((policies ?? []).map((policy) => [policy.data_type, policy.max_age_seconds]));
        const priceFresh = ageSeconds <= (policyMap.get("PRICE") ?? 0);
        const inventoryFresh = ageSeconds <= (policyMap.get("INVENTORY") ?? 0);
        const shippingFresh = ageSeconds <= (policyMap.get("SHIPPING") ?? 0);

        sellability = evaluateSellability({
          identityDecision: identity.decision,
          hardBlockReasons: identity.reasons.filter((r) => r.includes("CONFLICT") || r.includes("VARIANT")),
          orderability: offer.orderability,
          inventoryKnown: snapshot?.inventory != null,
          inventoryFresh,
          priceKnown: snapshot?.supplier_cost != null,
          priceFresh,
          supplierCost: snapshot?.supplier_cost ?? null,
          shippingCost: snapshot?.shipping_cost ?? null,
          requiredFeesKnown: profitability.complete,
          expectedProfit: profitability.expectedProfit,
          profitCurrency: offer.currency ?? "JPY",
        });
        if (!shippingFresh && sellability.status === "SELLABLE") {
          sellability = { status: "BLOCKED", reasons: [...sellability.reasons, "SHIPPING_STALE"] };
        }
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

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
  paymentFee?: number | null;
  marketplaceFee?: number | null;
  tax?: number | null;
  otherCost?: number | null;
};

function clean(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const supabase = getSupabaseAdmin();

    const identifiers: IdentityRecord["identifiers"] = [
      ["JAN", clean(body.jan)],
      ["EAN", clean(body.ean)],
      ["UPC", clean(body.upc)],
    ]
      .filter(([, value]) => Boolean(value))
      .map(([type, value]) => ({ type, value }));

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

    const { data: variants, error: variantError } = masterIds.length
      ? await supabase
          .from("product_variant")
          .select("master_product_id,color,size,capacity,generation,set_count,condition")
          .in("master_product_id", masterIds)
      : { data: [], error: null };
    if (variantError) throw variantError;

    const variantsByMaster = new Map<string, Array<IdentityRecord["variant"]>>();
    for (const row of variants ?? []) {
      const list = variantsByMaster.get(row.master_product_id) ?? [];
      list.push({
        color: row.color,
        size: row.size,
        capacity: row.capacity,
        generation: row.generation,
        setCount: row.set_count,
        condition: row.condition,
      });
      variantsByMaster.set(row.master_product_id, list);
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

    const candidates = [...byMaster.values()].flatMap((master) => {
      const variants = variantsByMaster.get(master.id);
      if (!variants?.length) return [master];
      return variants.map((variant) => ({ ...master, id: master.id, variant }));
    });

    const identity = matchIdentity(source, candidates);
    let profitability = null;
    let sellability = null;
    let purchase = null;

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
          paymentFee: body.paymentFee ?? null,
          marketplaceFee: body.marketplaceFee ?? null,
          tax: body.tax ?? null,
          otherCost: body.otherCost ?? null,
        });

        const { data: freshness, error: freshnessError } = await supabase
          .from("supplier_offer_freshness")
          .select("price_observed_at,inventory_observed_at,shipping_observed_at")
          .eq("supplier_offer_id", offer.id)
          .maybeSingle();
        if (freshnessError) throw freshnessError;
        const { data: policies, error: policyError } = await supabase
          .from("freshness_policy")
          .select("data_type,max_age_seconds");
        if (policyError) throw policyError;
        const policyMap = new Map((policies ?? []).map((policy) => [policy.data_type, policy.max_age_seconds]));
        const fresh = (timestamp: string | null | undefined, type: string) =>
          !!timestamp && (Date.now() - new Date(timestamp).getTime()) / 1000 <= (policyMap.get(type) ?? 0);
        const priceFresh = fresh(freshness?.price_observed_at, "PRICE");
        const inventoryFresh = fresh(freshness?.inventory_observed_at, "INVENTORY");
        const shippingFresh = fresh(freshness?.shipping_observed_at, "SHIPPING");

        sellability = evaluateSellability({
          identityDecision: identity.decision,
          hardBlockReasons: [
            ...identity.reasons.filter((r) => r.includes("CONFLICT") || r.includes("VARIANT")),
            ...(!shippingFresh ? ["SHIPPING_STALE"] : []),
          ],
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
        if (sellability.status === "SELLABLE" && snapshot?.supplier_cost != null && snapshot?.shipping_cost != null) {
          purchase = {
            masterProductId: identity.masterProductId,
            supplierOfferId: offer.id,
            amount: Math.round(Number(snapshot.supplier_cost) + Number(snapshot.shipping_cost)),
            currency: (offer.currency ?? "jpy").toLowerCase(),
          };
        }
      }
    }

    return NextResponse.json({
      decision: identity,
      profitability,
      sellability,
      candidateCount: candidates.length,
      purchase,
      source,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "DECISION_FAILED" },
      { status: 500 },
    );
  }
}

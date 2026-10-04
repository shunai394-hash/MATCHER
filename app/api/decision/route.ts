import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { type IdentityIdentifier, type IdentityRecord } from "@/lib/matcher/identity";
import { resolveIdentity } from "@/lib/matcher/identity-sync";
import { calculateExpectedProfit, evaluateSellability } from "@/lib/matcher/gate";
import { checkFreshness, toNumber } from "@/lib/matcher/opportunity";
import { fetchFreshnessPolicy, fetchLatestMatches, loadMasterCandidates } from "@/lib/server/matcher-data";
import { requireUserRole } from "@/lib/server/auth";

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
  const auth = await requireUserRole(request, "purchaser");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await request.json()) as Body;
    const supabase = getSupabaseAdmin();

    const identifiers: IdentityRecord["identifiers"] = [
      ["JAN", clean(body.jan)],
      ["EAN", clean(body.ean)],
      ["UPC", clean(body.upc)],
    ]
      .filter(([, value]) => Boolean(value))
      .map(([type, value]) => ({ type: type as IdentityIdentifier["type"], value }));

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

    const catalog = await loadMasterCandidates(supabase);
    // Same rules as the automatic sync: never AUTO_LINK to a candidate / rejected / inactive master.
    const identity = resolveIdentity(source, catalog.records, catalog.info).result;
    let profitability = null;
    let sellability = null;
    let purchase = null;

    if (identity.masterProductId && body.salePrice != null) {
      // Only supplier products whose *latest* identity decision is an un-blocked AUTO_LINK to this master.
      const { data: links, error: linkError } = await supabase
        .from("identity_match")
        .select("supplier_product_id,master_product_id,confidence,decision,hard_block,created_at")
        .eq("master_product_id", identity.masterProductId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (linkError) throw linkError;
      const candidateProductIds = [...new Set((links ?? []).map((link) => link.supplier_product_id as string))];
      const latestMatches = await fetchLatestMatches(supabase, candidateProductIds);
      const supplierProductIds = [...latestMatches.values()]
        .filter((row) => row.decision === "AUTO_LINK" && !row.hard_block && row.master_product_id === identity.masterProductId)
        .map((row) => row.supplier_product_id);

      const { data: offers, error: offerError } = supplierProductIds.length
        ? await supabase
            .from("supplier_offer")
            .select("id,supplier_product_id,orderability,currency")
            .in("supplier_product_id", supplierProductIds)
            .eq("orderability", "ORDERABLE")
            .order("updated_at", { ascending: false })
        : { data: [], error: null };
      if (offerError) throw offerError;

      const offer = (offers ?? [])[0];
      if (offer) {
        const { data: snapshots, error: snapshotError } = await supabase
          .from("supplier_offer_snapshot")
          .select("supplier_cost,shipping_cost,inventory,shipping_confidence,observed_at")
          .eq("supplier_offer_id", offer.id)
          .order("observed_at", { ascending: false })
          .limit(1);
        if (snapshotError) throw snapshotError;

        const snapshot = snapshots?.[0];
        const supplierCost = toNumber(snapshot?.supplier_cost);
        const shippingCost = toNumber(snapshot?.shipping_cost);
        const inventory = toNumber(snapshot?.inventory);
        profitability = calculateExpectedProfit({
          salePrice: body.salePrice,
          supplierCost,
          shippingCost,
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
        const policy = await fetchFreshnessPolicy(supabase);
        const now = Date.now();
        const priceFresh = checkFreshness(freshness?.price_observed_at, "PRICE", policy, now).fresh;
        const inventoryFresh = checkFreshness(freshness?.inventory_observed_at, "INVENTORY", policy, now).fresh;
        const shippingFresh = checkFreshness(freshness?.shipping_observed_at, "SHIPPING", policy, now).fresh;

        sellability = evaluateSellability({
          identityDecision: identity.decision,
          hardBlockReasons: [
            ...identity.reasons.filter((r) => r.includes("CONFLICT") || r.includes("VARIANT")),
            ...(!shippingFresh ? ["SHIPPING_STALE"] : []),
          ],
          orderability: offer.orderability,
          inventoryKnown: inventory !== null,
          inventoryAvailable: inventory !== null && inventory > 0,
          inventoryFresh,
          priceKnown: supplierCost !== null,
          priceFresh,
          supplierCost,
          shippingCost,
          requiredFeesKnown: profitability.complete,
          expectedProfit: profitability.expectedProfit,
          profitCurrency: offer.currency ?? "JPY",
        });
        if (sellability.status === "SELLABLE" && supplierCost !== null && shippingCost !== null) {
          purchase = {
            masterProductId: identity.masterProductId,
            supplierOfferId: offer.id,
            amount: supplierCost + shippingCost,
            currency: (offer.currency ?? "JPY").toLowerCase(),
          };
        }
      }
    }

    return NextResponse.json({
      decision: identity,
      profitability,
      sellability,
      candidateCount: catalog.records.length,
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

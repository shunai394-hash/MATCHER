import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { requireUserRole } from "@/lib/server/auth";
import { fetchFreshnessPolicy, fetchLatestMatches, identityEvidence, isAtOrAfter, loadOfferContexts, type SupplierOfferRow } from "@/lib/server/matcher-data";

export const dynamic = "force-dynamic";

/**
 * Verified purchase candidates. An offer is listed only if ALL hold on live data:
 * - latest identity_match is AUTO_LINK, not hard-blocked, linked to an existing master_product
 * - supplier_offer.orderability = ORDERABLE
 * - latest supplier_offer_snapshot has supplier_cost, shipping_cost (verified) and inventory > 0
 * - price / inventory / shipping freshness within freshness_policy
 * - a fresh market_price_observation exists with every fee known, same currency
 * - expected_profit > 0 and >= minProfit
 * - latest quality_gate_result is SELLABLE and was evaluated on the current inputs
 * Nothing is synthesized: with no qualifying data the list is empty and `excluded` says why.
 */
export async function GET(request: Request) {
  const auth = await requireUserRole(request, "purchaser");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(request.url);
    const minProfit = Math.max(0, Number(url.searchParams.get("minProfit") ?? 0) || 0);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));

    const { data: lastGate, error: lastGateError } = await supabase
      .from("quality_gate_result")
      .select("evaluated_at")
      .order("evaluated_at", { ascending: false })
      .limit(1);
    if (lastGateError) throw new Error(`quality_gate_result: ${lastGateError.message}`);
    const lastEvaluatedAt = (lastGate?.[0]?.evaluated_at as string | undefined) ?? null;

    const allMatches = await fetchLatestMatches(supabase);
    const linked = new Map([...allMatches].filter(([, row]) => row.decision === "AUTO_LINK" && !row.hard_block && !!row.master_product_id));
    const excluded: Record<string, number> = {};
    const exclude = (reason: string) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
    for (const row of allMatches.values()) {
      if (!linked.has(row.supplier_product_id)) exclude(row.hard_block ? "IDENTITY_HARD_BLOCK" : `IDENTITY_${row.decision}`);
    }

    const offers: SupplierOfferRow[] = [];
    const productIds = [...linked.keys()];
    for (let i = 0; i < productIds.length; i += 100) {
      const { data, error } = await supabase
        .from("supplier_offer")
        .select("id,supplier_product_id,currency,orderability,created_at,updated_at")
        .in("supplier_product_id", productIds.slice(i, i + 100));
      if (error) throw new Error(`supplier_offer: ${error.message}`);
      for (const offer of (data ?? []) as unknown as SupplierOfferRow[]) {
        if (offer.orderability === "ORDERABLE") offers.push(offer);
        else exclude("SUPPLIER_NOT_ORDERABLE");
      }
    }

    const policy = await fetchFreshnessPolicy(supabase);
    const contexts = await loadOfferContexts(supabase, offers, { policy, matches: linked });

    const passing = contexts.filter((ctx) => {
      if (ctx.evaluation.status !== "SELLABLE") {
        for (const reason of ctx.evaluation.reasons) exclude(reason);
        return false;
      }
      if (!ctx.latestGate) return exclude("GATE_NOT_EVALUATED"), false;
      if (ctx.latestGate.status !== "SELLABLE") return exclude("GATE_BLOCKED"), false;
      if (!isAtOrAfter(ctx.latestGate.evaluated_at, ctx.inputsObservedAt)) return exclude("GATE_OUTDATED_RECOMPUTE_REQUIRED"), false;
      const expectedProfit = ctx.evaluation.profit?.expectedProfit ?? null;
      if (expectedProfit === null || expectedProfit < minProfit) return exclude("BELOW_MIN_PROFIT"), false;
      return true;
    });
    const score = (ctx: typeof passing[number]) => {
      const profit = ctx.evaluation.profit?.expectedProfit ?? 0;
      const sale = ctx.evaluation.profit?.salePrice ?? 0;
      const margin = sale > 0 ? Math.max(0, profit / sale) : 0;
      const freshness = ["price", "inventory", "shipping", "market"].reduce((sum, key) => sum + (ctx.evaluation.freshness[key as keyof typeof ctx.evaluation.freshness].fresh ? 1 : 0), 0) / 4;
      const identity = Math.max(0, Math.min(1, Number(ctx.match?.confidence ?? 0)));
      const stock = ctx.snapshot?.inventory == null ? 0 : ctx.snapshot.inventory >= 2 ? 1 : ctx.snapshot.inventory > 0 ? 0.7 : 0;
      const demand = ctx.market?.sold === true ? 1 : 0.5;
      const profitComponent = Math.min(35, Math.max(0, profit / Math.max(minProfit, 1000) * 35));
      const marginComponent = Math.min(20, margin * 100);
      return profitComponent + marginComponent + identity * 20 + freshness * 15 + stock * 5 + demand * 5;
    };
    passing.sort((a, b) => score(b) - score(a));
    const shown = passing.slice(0, limit);
    const evidence = await identityEvidence(supabase, shown);

    const opportunities = shown.map((ctx) => {
      const profit = ctx.evaluation.profit!;
      const identity = evidence.get(ctx.offer.id);
      return {
        supplierOfferId: ctx.offer.id,
        supplierProductId: ctx.supplierProduct?.id ?? ctx.offer.supplier_product_id,
        masterProductId: ctx.master!.id,
        productName: ctx.master!.product_name,
        brand: ctx.master!.brand,
        modelNumber: ctx.master!.model_number,
        supplierName: ctx.supplierName,
        supplierProductName: ctx.supplierProduct?.product_name ?? null,
        supplierSku: ctx.supplierProduct?.supplier_sku ?? null,
        supplierUrl: ctx.supplierProduct?.source_url ?? null,
        currency: ctx.offer.currency,
        identity: {
          decision: ctx.match!.decision,
          confidence: Number(ctx.match!.confidence),
          linkedAt: ctx.match!.created_at,
          evidence: (identity?.evidence ?? []).filter((item) => item.weight > 0),
        },
        profit: {
          salePrice: profit.salePrice,
          supplierCost: profit.supplierCost,
          shippingCost: profit.shippingCost,
          paymentFee: profit.paymentFee,
          marketplaceFee: profit.marketplaceFee,
          tax: profit.tax,
          otherCost: profit.otherCost,
          expectedProfit: profit.expectedProfit,
          marginRate: profit.expectedProfit !== null && profit.salePrice > 0 ? Math.round((profit.expectedProfit / profit.salePrice) * 1000) / 10 : null,
        },
        market: {
          source: ctx.market?.source ?? null,
          sourceUrl: ctx.market?.source_url ?? null,
          sold: ctx.market?.sold ?? null,
          observedAt: ctx.market?.observed_at ?? null,
        },
        inventory: ctx.snapshot?.inventory ?? null,
        freshness: ctx.evaluation.freshness,
        gate: { status: ctx.latestGate!.status, evaluatedAt: ctx.latestGate!.evaluated_at },
        opportunityScore: Math.round(score(ctx) * 10) / 10,
      };
    });

    return NextResponse.json({
      opportunities,
      total: passing.length,
      minProfit,
      lastEvaluatedAt,
      checkedOffers: contexts.length,
      linkedProducts: linked.size,
      excluded,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OPPORTUNITIES_FAILED" },
      { status: 500 },
    );
  }
}

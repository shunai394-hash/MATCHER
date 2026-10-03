import type { getSupabaseAdmin } from "@/lib/server/supabase";
import { fetchFreshnessPolicy, fetchLatestMatches, isAtOrAfter, loadOfferContexts, syncIdentityMatches, type OfferContext, type SupplierOfferRow } from "@/lib/server/matcher-data";

/**
 * Recompute pipeline, safe to run repeatedly (cron, after every ingest, or manually):
 *   1. identity: supplier_product → master_product (identity_match, append-only, only on change)
 *   2. profit:   latest supplier_offer_snapshot × latest market_price_observation (profit_snapshot, only on change)
 *   3. gate:     SELLABLE / BLOCKED with reasons for every linked offer (quality_gate_result, only on change)
 * BLOCKED results are written too, so an offer that went out of stock or stale
 * can never keep an old SELLABLE result.
 */

type Db = ReturnType<typeof getSupabaseAdmin>;

function sameNumber(a: unknown, b: unknown) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Number(a) === Number(b);
}

function profitChanged(ctx: OfferContext) {
  const profit = ctx.evaluation.profit;
  if (!profit) return false;
  const prev = ctx.latestProfit;
  if (!prev) return true;
  if (!isAtOrAfter(prev.calculated_at, ctx.inputsObservedAt)) return true;
  return !(
    sameNumber(prev.sale_price, profit.salePrice) &&
    sameNumber(prev.supplier_cost, profit.supplierCost) &&
    sameNumber(prev.shipping_cost, profit.shippingCost) &&
    sameNumber(prev.payment_fee, profit.paymentFee) &&
    sameNumber(prev.marketplace_fee, profit.marketplaceFee) &&
    sameNumber(prev.tax, profit.tax) &&
    sameNumber(prev.other_cost, profit.otherCost) &&
    sameNumber(prev.expected_profit, profit.expectedProfit) &&
    prev.cost_complete === profit.complete
  );
}

function gateChanged(ctx: OfferContext) {
  const prev = ctx.latestGate;
  if (!prev) return true;
  if (prev.status !== ctx.evaluation.status) return true;
  const a = [...(Array.isArray(prev.blocking_reasons) ? prev.blocking_reasons : [])].sort().join("|");
  const b = [...ctx.evaluation.reasons].sort().join("|");
  if (a !== b) return true;
  return !isAtOrAfter(prev.evaluated_at, ctx.inputsObservedAt);
}

export async function recomputeOpportunities(supabase: Db) {
  const startedAt = new Date().toISOString();

  const identity = await syncIdentityMatches(supabase);

  const matches = await fetchLatestMatches(supabase);
  const productIds = [...matches.keys()];
  const offers: SupplierOfferRow[] = [];
  for (let i = 0; i < productIds.length; i += 100) {
    const { data, error } = await supabase
      .from("supplier_offer")
      .select("id,supplier_product_id,currency,orderability,created_at,updated_at")
      .in("supplier_product_id", productIds.slice(i, i + 100));
    if (error) throw new Error(`supplier_offer: ${error.message}`);
    offers.push(...((data ?? []) as unknown as SupplierOfferRow[]));
  }

  const policy = await fetchFreshnessPolicy(supabase);
  const now = Date.now();
  const contexts = await loadOfferContexts(supabase, offers, { policy, matches, now });

  const nowIso = new Date(now).toISOString();
  const profitInserts: Array<Record<string, unknown>> = [];
  const gateInserts: Array<Record<string, unknown>> = [];
  const blockedReasons: Record<string, number> = {};
  let sellable = 0;
  for (const ctx of contexts) {
    const { evaluation } = ctx;
    if (evaluation.status === "SELLABLE") sellable += 1;
    for (const reason of evaluation.reasons) blockedReasons[reason] = (blockedReasons[reason] ?? 0) + 1;

    if (evaluation.profit && profitChanged(ctx)) {
      profitInserts.push({
        supplier_offer_id: ctx.offer.id,
        sale_price: evaluation.profit.salePrice,
        supplier_cost: evaluation.profit.supplierCost,
        shipping_cost: evaluation.profit.shippingCost,
        payment_fee: evaluation.profit.paymentFee,
        marketplace_fee: evaluation.profit.marketplaceFee,
        tax: evaluation.profit.tax,
        other_cost: evaluation.profit.otherCost,
        expected_profit: evaluation.profit.expectedProfit,
        cost_complete: evaluation.profit.complete,
        calculated_at: nowIso,
      });
    }
    if (gateChanged(ctx)) {
      gateInserts.push({
        supplier_offer_id: ctx.offer.id,
        status: evaluation.status,
        checks: evaluation.checks,
        blocking_reasons: evaluation.reasons,
        evaluated_at: nowIso,
      });
    }
  }

  for (let i = 0; i < profitInserts.length; i += 100) {
    const { error } = await supabase.from("profit_snapshot").insert(profitInserts.slice(i, i + 100));
    if (error) throw new Error(`profit_snapshot insert: ${error.message}`);
  }
  for (let i = 0; i < gateInserts.length; i += 100) {
    const { error } = await supabase.from("quality_gate_result").insert(gateInserts.slice(i, i + 100));
    if (error) throw new Error(`quality_gate_result insert: ${error.message}`);
  }

  return {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    identity,
    offersEvaluated: contexts.length,
    sellable,
    blocked: contexts.length - sellable,
    profitSnapshotsWritten: profitInserts.length,
    gateResultsWritten: gateInserts.length,
    blockedReasons,
  };
}


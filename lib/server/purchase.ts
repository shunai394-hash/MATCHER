import type { getSupabaseAdmin } from "@/lib/server/supabase";
import { fetchFreshnessPolicy, fetchLatestMatches, isAtOrAfter, loadOfferContexts, type SupplierOfferRow } from "@/lib/server/matcher-data";
import { toStripeMinorUnits } from "@/lib/server/stripe";

type Db = ReturnType<typeof getSupabaseAdmin>;

/** What the human approved on screen. The server refuses to charge anything else. */
export type ApprovedTerms = {
  /** supplier_cost + shipping_cost, major units (e.g. 4700 JPY). */
  amount: number;
  /** Profit the human saw; the live profit must not be lower. */
  expectedProfit?: number | null;
};

export type VerifiedTerms = {
  verifiedAt: string;
  masterProductId: string;
  supplierOfferId: string;
  identityMatchId: string;
  identityLinkedAt: string;
  gateResultId: string;
  gateEvaluatedAt: string;
  profitSnapshotId: string;
  profitCalculatedAt: string;
  snapshotObservedAt: string | null;
  supplierCost: number;
  shippingCost: number;
  inventory: number;
  salePrice: number;
  expectedProfit: number;
  currency: string;
  amount: number;
  amountMinor: number;
};

export type PurchaseCheck =
  | { ok: true; terms: VerifiedTerms }
  | { ok: false; status: 404 | 409; error: string; reasons?: string[]; current?: Partial<VerifiedTerms> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/**
 * Re-verifies a purchase against the newest data immediately before money moves
 * (Stripe authorization, and again before capture). Every condition is read fresh:
 * latest identity_match, latest quality_gate_result, latest profit_snapshot, latest
 * supplier_offer_snapshot (price, shipping, stock) and freshness. An older AUTO_LINK,
 * an outdated gate or a changed price is refused.
 */
export async function verifyPurchase(db: Db, input: { masterProductId: string; supplierOfferId: string; approved: ApprovedTerms }): Promise<PurchaseCheck> {
  const { data: offerRow, error: offerError } = await db
    .from("supplier_offer")
    .select("id,supplier_product_id,currency,orderability,created_at,updated_at")
    .eq("id", input.supplierOfferId)
    .maybeSingle();
  if (offerError) throw new Error(`supplier_offer: ${offerError.message}`);
  if (!offerRow) return { ok: false, status: 404, error: "OFFER_NOT_FOUND" };
  const offer = offerRow as unknown as SupplierOfferRow;

  // Latest identity decision for this supplier product (an older AUTO_LINK never counts).
  const matches = await fetchLatestMatches(db, [offer.supplier_product_id]);
  const match = matches.get(offer.supplier_product_id);
  if (!match || match.decision !== "AUTO_LINK" || match.hard_block || match.master_product_id !== input.masterProductId) {
    return { ok: false, status: 409, error: "IDENTITY_LINK_NOT_CONFIRMED", reasons: [match ? (match.hard_block ? "HARD_BLOCK" : match.decision) : "NO_IDENTITY_MATCH"] };
  }

  const policy = await fetchFreshnessPolicy(db);
  const [ctx] = await loadOfferContexts(db, [offer], { policy, matches });
  const evaluation = ctx.evaluation;
  if (evaluation.status !== "SELLABLE" || !evaluation.profit || evaluation.profit.expectedProfit === null || !ctx.snapshot) {
    return { ok: false, status: 409, error: "PURCHASE_NOT_SELLABLE", reasons: evaluation.reasons };
  }
  const gate = ctx.latestGate;
  if (!gate || gate.status !== "SELLABLE") return { ok: false, status: 409, error: "QUALITY_GATE_NOT_SELLABLE", reasons: gate?.blocking_reasons ?? ["GATE_NOT_EVALUATED"] };
  if (!isAtOrAfter(gate.evaluated_at, ctx.inputsObservedAt)) return { ok: false, status: 409, error: "QUALITY_GATE_OUTDATED" };

  const profitRow = ctx.latestProfit;
  const profit = evaluation.profit;
  if (
    !profitRow || !profitRow.cost_complete || !isAtOrAfter(profitRow.calculated_at, ctx.inputsObservedAt) ||
    Number(profitRow.expected_profit) !== profit.expectedProfit ||
    Number(profitRow.supplier_cost) !== profit.supplierCost ||
    Number(profitRow.shipping_cost) !== profit.shippingCost
  ) {
    return { ok: false, status: 409, error: "PROFIT_SNAPSHOT_OUTDATED" };
  }

  const supplierCost = profit.supplierCost!;
  const shippingCost = profit.shippingCost!;
  const amount = Math.round((supplierCost + shippingCost) * 100) / 100;
  const currency = offer.currency.trim().toLowerCase();
  const amountMinor = toStripeMinorUnits(amount, currency);
  const terms: VerifiedTerms = {
    verifiedAt: new Date().toISOString(),
    masterProductId: input.masterProductId,
    supplierOfferId: offer.id,
    identityMatchId: match.id,
    identityLinkedAt: match.created_at,
    gateResultId: gate.id,
    gateEvaluatedAt: gate.evaluated_at,
    profitSnapshotId: profitRow.id,
    profitCalculatedAt: profitRow.calculated_at,
    snapshotObservedAt: ctx.snapshot.observed_at,
    supplierCost,
    shippingCost,
    inventory: Number(ctx.snapshot.inventory),
    salePrice: profit.salePrice,
    expectedProfit: profit.expectedProfit!,
    currency,
    amount,
    amountMinor,
  };
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { ok: false, status: 409, error: "INVALID_PURCHASE_AMOUNT" };

  // The human approved specific numbers; anything different needs a new approval.
  if (!(typeof input.approved.amount === "number" && Number.isFinite(input.approved.amount)) || Math.abs(input.approved.amount - amount) > 0.005) {
    return { ok: false, status: 409, error: "PURCHASE_TERMS_CHANGED", reasons: ["AMOUNT_CHANGED"], current: { amount, supplierCost, shippingCost, expectedProfit: terms.expectedProfit } };
  }
  if (input.approved.expectedProfit != null && terms.expectedProfit + 0.005 < input.approved.expectedProfit) {
    return { ok: false, status: 409, error: "PURCHASE_TERMS_CHANGED", reasons: ["PROFIT_DECREASED"], current: { amount, expectedProfit: terms.expectedProfit } };
  }
  return { ok: true, terms };
}

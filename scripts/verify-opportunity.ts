import { strict as assert } from "node:assert";
import { buildFreshnessPolicy, checkFreshness, evaluateOffer, type OfferEvaluationInput } from "../lib/matcher/opportunity.ts";
import { planIdentityWrite, toIdentityMatchRow } from "../lib/matcher/identity-sync.ts";
import { matchIdentity } from "../lib/matcher/identity.ts";

const now = Date.parse("2026-10-03T09:00:00Z");
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const policy = buildFreshnessPolicy([
  { data_type: "PRICE", max_age_seconds: 86400 },
  { data_type: "INVENTORY", max_age_seconds: 21600 },
  { data_type: "SHIPPING", max_age_seconds: 604800 },
]);

function base(): OfferEvaluationInput {
  return {
    now,
    policy,
    match: { decision: "AUTO_LINK", hardBlock: false, masterProductId: "m1", masterSellable: true, confidence: 1 },
    offer: { orderability: "ORDERABLE", currency: "JPY" },
    snapshot: { supplierCost: 4000, shippingCost: 600, inventory: 5, shippingConfidence: 1, observedAt: minutesAgo(10) },
    freshness: { priceObservedAt: minutesAgo(10), inventoryObservedAt: minutesAgo(10), shippingObservedAt: minutesAgo(10) },
    market: { salePrice: 9800, paymentFee: 300, marketplaceFee: 980, tax: 0, otherCost: 100, currency: "JPY", observedAt: minutesAgo(60) },
  };
}

// Happy path: every condition proven → SELLABLE with exact profit.
const ok = evaluateOffer(base());
assert.equal(ok.status, "SELLABLE", JSON.stringify(ok.reasons));
assert.deepEqual(ok.reasons, []);
assert.equal(ok.profit?.expectedProfit, 9800 - 4000 - 600 - 300 - 980 - 0 - 100);
assert.equal(ok.checks.inventory, "AVAILABLE");

function blockedWith(mutate: (input: OfferEvaluationInput) => void, reason: string) {
  const input = base();
  mutate(input);
  const result = evaluateOffer(input);
  assert.equal(result.status, "BLOCKED", `${reason}: expected BLOCKED`);
  assert.ok(result.reasons.includes(reason), `${reason}: got ${result.reasons.join(",")}`);
}

// Identity
blockedWith((i) => { i.match = null; }, "IDENTITY_NOT_MATCHED");
blockedWith((i) => { i.match!.decision = "REVIEW"; }, "IDENTITY_NOT_AUTO_LINKED");
blockedWith((i) => { i.match!.hardBlock = true; }, "IDENTITY_HARD_BLOCK");
blockedWith((i) => { i.match!.masterProductId = null; }, "IDENTITY_MASTER_MISSING");
blockedWith((i) => { i.match!.masterSellable = false; }, "MASTER_NOT_APPROVED");
// Orderability / inventory
blockedWith((i) => { i.offer.orderability = "OUT_OF_STOCK"; }, "SUPPLIER_NOT_ORDERABLE");
blockedWith((i) => { i.snapshot!.inventory = 0; }, "OUT_OF_STOCK");
blockedWith((i) => { i.snapshot!.inventory = null; }, "INVENTORY_UNKNOWN");
blockedWith((i) => { i.snapshot = null; }, "SUPPLIER_SNAPSHOT_MISSING");
// Price / shipping
blockedWith((i) => { i.snapshot!.supplierCost = null; }, "SUPPLIER_COST_UNKNOWN");
blockedWith((i) => { i.snapshot!.shippingCost = null; }, "SHIPPING_COST_UNKNOWN");
{
  const input = base();
  input.snapshot!.shippingCost = null;
  assert.ok(!evaluateOffer(input).reasons.includes("REQUIRED_FEES_UNKNOWN"), "missing shipping is not a missing fee");
}
blockedWith((i) => { i.snapshot!.shippingConfidence = 0; }, "SHIPPING_UNVERIFIED");
// Freshness
blockedWith((i) => { i.freshness!.priceObservedAt = minutesAgo(60 * 25); }, "PRICE_STALE");
blockedWith((i) => { i.freshness!.inventoryObservedAt = minutesAgo(60 * 7); }, "INVENTORY_STALE");
blockedWith((i) => { i.freshness!.shippingObservedAt = minutesAgo(60 * 24 * 8); }, "SHIPPING_STALE");
blockedWith((i) => { i.freshness = null; }, "FRESHNESS_RECORD_MISSING");
blockedWith((i) => { i.policy = new Map(); }, "FRESHNESS_POLICY_PRICE_MISSING");
blockedWith((i) => { i.freshness!.priceObservedAt = new Date(now + 3_600_000).toISOString(); }, "PRICE_STALE");
// Market / profit
blockedWith((i) => { i.market = null; }, "MARKET_PRICE_MISSING");
blockedWith((i) => { i.market!.observedAt = minutesAgo(60 * 24 * 8); }, "MARKET_PRICE_STALE");
blockedWith((i) => { i.market!.tax = null; }, "REQUIRED_FEES_UNKNOWN");
blockedWith((i) => { i.market!.currency = "USD"; }, "CURRENCY_MISMATCH");
blockedWith((i) => { i.market!.salePrice = 5000; }, "PROFIT_NOT_POSITIVE");

// freshness_policy keyed by either column name
assert.equal(buildFreshnessPolicy([{ metric: "PRICE", max_age_seconds: 10 }]).get("PRICE"), 10);
assert.equal(checkFreshness(null, "PRICE", policy, now).fresh, false);
assert.equal(checkFreshness("not-a-date", "PRICE", policy, now).fresh, false);

// Identity write planning: no duplicates, never override a human REJECT, safety wins.
const autoLink = toIdentityMatchRow({ decision: "AUTO_LINK", masterProductId: "m1", confidence: 1, reasons: [], evidence: [] });
const block = toIdentityMatchRow({ decision: "BLOCK", masterProductId: "m1", confidence: 0.99, reasons: [], evidence: [] });
const review = toIdentityMatchRow({ decision: "REVIEW", masterProductId: null, confidence: 0.45, reasons: [], evidence: [] });
assert.equal(block.hard_block, true);
assert.deepEqual(planIdentityWrite(null, autoLink), autoLink);
assert.equal(planIdentityWrite({ decision: "AUTO_LINK", masterProductId: "m1", hardBlock: false }, autoLink), null);
assert.equal(planIdentityWrite({ decision: "REJECT", masterProductId: "m1", hardBlock: false }, autoLink), null);
assert.deepEqual(planIdentityWrite({ decision: "AUTO_LINK", masterProductId: "m1", hardBlock: false }, block), block);
assert.deepEqual(planIdentityWrite({ decision: "REVIEW", masterProductId: null, hardBlock: false }, autoLink), autoLink);
assert.equal(planIdentityWrite({ decision: "AUTO_LINK", masterProductId: "m1", hardBlock: false }, review), null);
assert.equal(planIdentityWrite({ decision: "REVIEW", masterProductId: null, hardBlock: false }, review), null);
assert.equal(planIdentityWrite({ decision: "AUTO_LINK", masterProductId: "m2", hardBlock: false }, autoLink)?.decision, "REVIEW");
assert.deepEqual(planIdentityWrite({ decision: "BLOCK", masterProductId: "m1", hardBlock: true }, autoLink), autoLink);

// Supplier record with matching JAN but conflicting capacity must not AUTO_LINK.
const conflict = matchIdentity(
  { id: "sp", brand: "ACME", modelNumber: "AX-204", identifiers: [{ type: "JAN", value: "4901234567894" }], variant: { capacity: "128GB" } },
  [{ id: "m", brand: "ACME", modelNumber: "AX-204", identifiers: [{ type: "JAN", value: "4901234567894" }], variant: { capacity: "256GB" } }],
);
assert.equal(conflict.decision, "BLOCK");
assert.equal(toIdentityMatchRow(conflict).hard_block, true);

console.log("MATCHER opportunity gate verification: PASS");

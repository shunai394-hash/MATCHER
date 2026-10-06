import { strict as assert } from "node:assert";
import { scoreOpportunity } from "../lib/matcher/opportunity.ts";
import { marketScores } from "../lib/matcher/live-opportunities.ts";

const priority = scoreOpportunity({
  expectedProfit: 5000, roiPercent: 60, salesVelocity: 90, competition: 80,
  priceStability: 85, freshness: 95, identityStrength: 100, risk: 5,
});
assert.equal(priority.tier, "PRIORITY");
assert.ok(priority.score >= 72);

const higherProfit = scoreOpportunity({
  expectedProfit: 9000, roiPercent: 60, salesVelocity: 90, competition: 80,
  priceStability: 85, freshness: 95, identityStrength: 100, risk: 5,
});
assert.ok(higherProfit.score > priority.score);

const manageableCompetition = scoreOpportunity({
  expectedProfit: 5000, roiPercent: 60, salesVelocity: 90, competition: 20,
  priceStability: 85, freshness: 95, identityStrength: 100, risk: 5,
});
const highCompetition = scoreOpportunity({
  expectedProfit: 5000, roiPercent: 60, salesVelocity: 90, competition: 80,
  priceStability: 85, freshness: 95, identityStrength: 100, risk: 5,
});
assert.ok(manageableCompetition.score > highCompetition.score, "higher competition pressure must lower the score");

const lowListingPressure = marketScores({
  master_product_id: "m", source: "test", window_start: "2026-10-01T00:00:00Z", window_end: "2026-10-02T00:00:00Z",
  sales_count: 10, active_listing_count: 1, median_sale_price: 10000, price_stddev: 500, observed_at: "2026-10-05T00:00:00Z", evidence_url: null,
});
const highListingPressure = marketScores({
  master_product_id: "m", source: "test", window_start: "2026-10-01T00:00:00Z", window_end: "2026-10-02T00:00:00Z",
  sales_count: 10, active_listing_count: 100, median_sale_price: 10000, price_stddev: 500, observed_at: "2026-10-05T00:00:00Z", evidence_url: null,
});
assert.ok(lowListingPressure.competition < highListingPressure.competition, "more listings must mean more competition pressure");

const risky = scoreOpportunity({
  expectedProfit: 9000, roiPercent: 80, salesVelocity: 80, competition: 70,
  priceStability: 40, freshness: 30, identityStrength: 100, risk: 80,
});
assert.notEqual(risky.tier, "PRIORITY");

const staleHighMargin = scoreOpportunity({
  expectedProfit: 12000, roiPercent: 90, salesVelocity: 95, competition: 90,
  priceStability: 90, freshness: 20, identityStrength: 100, risk: 5,
});
assert.notEqual(staleHighMargin.tier, "PRIORITY");
assert.ok(staleHighMargin.reasons.includes("data freshness too low"));

const zeroProfit = scoreOpportunity({
  expectedProfit: 0, roiPercent: 90, salesVelocity: 95, competition: 90,
  priceStability: 90, freshness: 95, identityStrength: 100, risk: 5,
});
assert.notEqual(zeroProfit.tier, "PRIORITY");

const staleMarket = scoreOpportunity({
  expectedProfit: 5000, roiPercent: 40, salesVelocity: 90, competition: 90,
  priceStability: 90, freshness: 0, identityStrength: 100, risk: 10,
});
assert(staleMarket.tier !== "PRIORITY", "stale market evidence must never be PRIORITY");

const zeroMarket = scoreOpportunity({
  expectedProfit: 5000, roiPercent: 40, salesVelocity: 0, competition: 0,
  priceStability: 0, freshness: 90, identityStrength: 100, risk: 10,
});
assert(zeroMarket.tier !== "PRIORITY", "missing market signals must not become PRIORITY");

const malformedMarket = marketScores({
  master_product_id: "m", source: "test", window_start: "not-a-date", window_end: "also-not-a-date",
  sales_count: -10, active_listing_count: -5, median_sale_price: 10000, price_stddev: 500,
  observed_at: "not-a-date", evidence_url: null,
});
assert.deepEqual(malformedMarket, { demandVelocity: 0, competition: 0, priceStability: 0 });

const nonFiniteInputs = scoreOpportunity({
  expectedProfit: Number.NaN, roiPercent: Number.POSITIVE_INFINITY, salesVelocity: Number.NaN,
  competition: Number.NaN, priceStability: Number.NaN, freshness: Number.NaN,
  identityStrength: Number.NaN, risk: Number.NaN,
});
assert.equal(nonFiniteInputs.score, 0);
assert.equal(nonFiniteInputs.tier, "REJECT");
assert.ok(Number.isFinite(nonFiniteInputs.score));

console.log("MATCHER opportunity scoring verification: PASS");


const futureTimestamp = new Date(Date.now() + 60_000).toISOString();
const futureMarket = marketScores({
  master_product_id: "m", source: "test", window_start: "2026-10-01T00:00:00Z", window_end: "2026-10-02T00:00:00Z",
  sales_count: 10, active_listing_count: 2, median_sale_price: 10000, price_stddev: 500, observed_at: futureTimestamp, evidence_url: null,
});
assert.deepEqual(futureMarket, { demandVelocity: 100, competition: 24, priceStability: 95 });
console.log("MATCHER future freshness boundary verification: PASS");

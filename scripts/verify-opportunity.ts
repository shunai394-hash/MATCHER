import { strict as assert } from "node:assert";
import { scoreOpportunity } from "../lib/matcher/opportunity.ts";

const manageableCompetition = scoreOpportunity({
  expectedProfit: 5000, roiPercent: 60, salesVelocity: 90, competition: 20,
  priceStability: 85, freshness: 95, identityStrength: 100, risk: 5,
});
assert.equal(manageableCompetition.tier, "PRIORITY");
assert.ok(manageableCompetition.score >= 72);
assert.ok(manageableCompetition.reasons.includes("competition manageable"));

const highCompetition = scoreOpportunity({
  expectedProfit: 5000, roiPercent: 60, salesVelocity: 90, competition: 80,
  priceStability: 85, freshness: 95, identityStrength: 100, risk: 5,
});
assert.ok(manageableCompetition.score > highCompetition.score);
assert.ok(highCompetition.reasons.includes("competition pressure high"));

const higherProfit = scoreOpportunity({
  expectedProfit: 9000, roiPercent: 60, salesVelocity: 90, competition: 80,
  priceStability: 85, freshness: 95, identityStrength: 100, risk: 5,
});
assert.ok(higherProfit.score > highCompetition.score);

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

console.log("MATCHER opportunity scoring verification: PASS");

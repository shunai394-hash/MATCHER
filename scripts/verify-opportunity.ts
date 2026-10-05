import { strict as assert } from "node:assert";
import { scoreOpportunity } from "../lib/matcher/opportunity.ts";

const priority = scoreOpportunity({
  expectedProfit: 5000, roiPercent: 60, salesVelocity: 90, competition: 80,
  priceStability: 85, freshness: 95, identityStrength: 100, risk: 5,
});
assert.equal(priority.tier, "PRIORITY");
assert.ok(priority.score >= 72);

const risky = scoreOpportunity({
  expectedProfit: 9000, roiPercent: 80, salesVelocity: 80, competition: 70,
  priceStability: 40, freshness: 30, identityStrength: 100, risk: 80,
});
assert.notEqual(risky.tier, "PRIORITY");

console.log("MATCHER opportunity scoring verification: PASS");

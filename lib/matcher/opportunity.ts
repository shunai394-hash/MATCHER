export type OpportunityInput = {
  expectedProfit: number;
  roiPercent: number;
  salesVelocity: number;
  competition: number;
  priceStability: number;
  freshness: number;
  identityStrength: number;
  risk: number;
};

export type OpportunityResult = {
  score: number;
  tier: "PRIORITY" | "WATCH" | "REJECT";
  reasons: string[];
};

export function scoreOpportunity(input: OpportunityInput): OpportunityResult {
  const bounded = (n: number) => Math.max(0, Math.min(100, n));
  const score = Math.round(
    bounded(input.roiPercent) * 0.24 +
    bounded(input.salesVelocity) * 0.22 +
    bounded(input.competition) * 0.12 +
    bounded(input.priceStability) * 0.12 +
    bounded(input.freshness) * 0.10 +
    bounded(input.identityStrength) * 0.20 -
    bounded(input.risk) * 0.24,
  );

  const reasons: string[] = [];
  if (input.roiPercent >= 30) reasons.push("ROI strong");
  if (input.salesVelocity >= 70) reasons.push("demand moving");
  if (input.competition >= 70) reasons.push("competition manageable");
  if (input.priceStability >= 70) reasons.push("price stable");
  if (input.identityStrength >= 90) reasons.push("identity proven");
  if (input.risk >= 40) reasons.push("risk needs review");

  return {
    score: Math.max(0, Math.min(100, score)),
    tier: score >= 72 ? "PRIORITY" : score >= 52 ? "WATCH" : "REJECT",
    reasons,
  };
}

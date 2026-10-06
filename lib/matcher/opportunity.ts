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
  const bounded = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  const safeProfit = Number.isFinite(input.expectedProfit) && input.expectedProfit > 0;
  const profitPotential = safeProfit
    ? Math.min(100, Math.max(0, 20 + (80 * Math.log10(input.expectedProfit + 1)) / Math.log10(10001)))
    : 0;

  // Competition is pressure: more competing listings must reduce opportunity.
  const score = Math.round(
    profitPotential * 0.18 +
    bounded(input.roiPercent) * 0.18 +
    bounded(input.salesVelocity) * 0.18 -
    bounded(input.competition) * 0.10 +
    bounded(input.priceStability) * 0.10 +
    bounded(input.freshness) * 0.10 +
    bounded(input.identityStrength) * 0.16 -
    bounded(input.risk) * 0.20,
  );

  const reasons: string[] = [];
  if (safeProfit) reasons.push(`profit positive: ¥${Math.round(input.expectedProfit).toLocaleString()}`);
  else reasons.push("profit unavailable or non-positive");
  if (input.roiPercent >= 30) reasons.push("ROI strong");
  if (input.salesVelocity >= 70) reasons.push("demand moving");
  if (input.competition <= 30) reasons.push("competition light");
  else if (input.competition >= 70) reasons.push("competition pressure high");
  if (input.priceStability >= 70) reasons.push("price stable");
  if (input.identityStrength >= 90) reasons.push("identity proven");
  if (input.freshness < 70) reasons.push("data freshness too low");
  if (input.risk >= 40) reasons.push("risk needs review");

  const safeForPriority =
    safeProfit &&
    input.freshness >= 70 &&
    input.identityStrength >= 90 &&
    input.risk < 40;

  const finalScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  return {
    score: finalScore,
    tier: safeForPriority && finalScore >= 72 ? "PRIORITY" : finalScore >= 52 ? "WATCH" : "REJECT",
    reasons,
  };
}

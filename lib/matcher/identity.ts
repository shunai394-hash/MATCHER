export type IdentityDecision = "AUTO_LINK" | "REVIEW" | "BLOCK";

export type IdentityInput = {
  gtin?: string | null;
  mpn?: string | null;
  brand?: string | null;
  modelNumber?: string | null;
  title?: string | null;
  color?: string | null;
  size?: string | null;
  capacity?: string | null;
  generation?: string | null;
  setCount?: number | null;
  condition?: string | null;
};

export type IdentityEvidence = {
  field: string;
  result: "EXACT" | "MISMATCH" | "MISSING" | "WEAK";
  sourceValue: string | null;
  masterValue: string | null;
  reason: string;
};

export type IdentityResult = {
  decision: IdentityDecision;
  matchMethod: "STRONG" | "WEAK" | "NONE";
  evidence: IdentityEvidence[];
  blockingReasons: string[];
};

const normalizeText = (value?: string | null) =>
  value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("ja-JP") || null;

const normalizeGtin = (value?: string | null) =>
  value?.replace(/[^0-9]/g, "") || null;

const normalizeSetCount = (value?: number | null) =>
  value === null || value === undefined ? null : Number(value);

const exactPair = (
  field: string,
  sourceValue: string | null,
  masterValue: string | null,
  reason: string,
  evidence: IdentityEvidence[],
  blockingReasons: string[],
) => {
  if (!sourceValue || !masterValue) {
    evidence.push({ field, result: "MISSING", sourceValue, masterValue, reason });
    return;
  }
  if (sourceValue === masterValue) {
    evidence.push({ field, result: "EXACT", sourceValue, masterValue, reason });
  } else {
    evidence.push({ field, result: "MISMATCH", sourceValue, masterValue, reason });
    blockingReasons.push(`${field.toUpperCase()}_MISMATCH`);
  }
};

export function evaluateIdentityMatch(
  source: IdentityInput,
  master: IdentityInput,
): IdentityResult {
  const evidence: IdentityEvidence[] = [];
  const blockingReasons: string[] = [];

  const sourceGtin = normalizeGtin(source.gtin);
  const masterGtin = normalizeGtin(master.gtin);
  const sourceMpn = normalizeText(source.mpn || source.modelNumber);
  const masterMpn = normalizeText(master.mpn || master.modelNumber);

  exactPair("gtin", sourceGtin, masterGtin, "GTIN must match exactly when both are present.", evidence, blockingReasons);
  exactPair("mpn", sourceMpn, masterMpn, "MPN/model number must match exactly when both are present.", evidence, blockingReasons);

  const variantFields: Array<[string, string | null, string | null]> = [
    ["brand", normalizeText(source.brand), normalizeText(master.brand)],
    ["color", normalizeText(source.color), normalizeText(master.color)],
    ["size", normalizeText(source.size), normalizeText(master.size)],
    ["capacity", normalizeText(source.capacity), normalizeText(master.capacity)],
    ["generation", normalizeText(source.generation), normalizeText(master.generation)],
    ["condition", normalizeText(source.condition), normalizeText(master.condition)],
  ];

  for (const [field, sourceValue, masterValue] of variantFields) {
    exactPair(field, sourceValue, masterValue, `${field} must not contradict the master when both are known.`, evidence, blockingReasons);
  }

  const sourceSetCount = normalizeSetCount(source.setCount);
  const masterSetCount = normalizeSetCount(master.setCount);
  if (sourceSetCount === null || masterSetCount === null) {
    evidence.push({
      field: "set_count",
      result: "MISSING",
      sourceValue: sourceSetCount === null ? null : String(sourceSetCount),
      masterValue: masterSetCount === null ? null : String(masterSetCount),
      reason: "Set count is blocking only when both values are known and disagree.",
    });
  } else if (sourceSetCount === masterSetCount) {
    evidence.push({
      field: "set_count",
      result: "EXACT",
      sourceValue: String(sourceSetCount),
      masterValue: String(masterSetCount),
      reason: "Set count matches exactly.",
    });
  } else {
    evidence.push({
      field: "set_count",
      result: "MISMATCH",
      sourceValue: String(sourceSetCount),
      masterValue: String(masterSetCount),
      reason: "Set count mismatch is a hard block.",
    });
    blockingReasons.push("SET_COUNT_MISMATCH");
  }

  if (blockingReasons.length) {
    return {
      decision: "BLOCK",
      matchMethod: "NONE",
      evidence,
      blockingReasons: [...new Set(blockingReasons)],
    };
  }

  const gtinExact = Boolean(sourceGtin && masterGtin && sourceGtin === masterGtin);
  const mpnExact = Boolean(sourceMpn && masterMpn && sourceMpn === masterMpn);
  const brandExact = Boolean(
    normalizeText(source.brand) &&
      normalizeText(master.brand) &&
      normalizeText(source.brand) === normalizeText(master.brand),
  );

  if (gtinExact || (mpnExact && brandExact)) {
    return {
      decision: "AUTO_LINK",
      matchMethod: "STRONG",
      evidence,
      blockingReasons: [],
    };
  }

  if (source.title && master.title) {
    evidence.push({
      field: "title",
      result: "WEAK",
      sourceValue: normalizeText(source.title),
      masterValue: normalizeText(master.title),
      reason: "Title similarity is never sufficient for automatic linking.",
    });
  }

  return {
    decision: "REVIEW",
    matchMethod: "WEAK",
    evidence,
    blockingReasons: [],
  };
}

export type IdentifierType = "JAN" | "EAN" | "UPC" | "MPN" | "SKU" | "SUPPLIER_PRODUCT_NO";

export type ProductIdentifier = { type: IdentifierType; value: string };

export type IdentityCandidate = {
  brand?: string | null;
  modelNumber?: string | null;
  title?: string | null;
  identifiers?: ProductIdentifier[];
  color?: string | null;
  size?: string | null;
  capacity?: string | null;
  generation?: string | null;
  setCount?: number | null;
  condition?: string | null;
};

export type IdentityDecision = "AUTO_LINK" | "REVIEW" | "BLOCK";

export type IdentityEvidence = {
  field: string;
  candidate: string | number | null;
  master: string | number | null;
  result: "MATCH" | "MISMATCH" | "MISSING" | "WEAK";
  reason: string;
};

export type IdentityMatchResult = {
  decision: IdentityDecision;
  matchMethod: "STRONG" | "WEAK" | "NONE";
  hardBlockReasons: string[];
  evidence: IdentityEvidence[];
};

const GLOBAL_IDENTIFIERS: IdentifierType[] = ["JAN", "EAN", "UPC"];

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "").replaceAll("-", "");
  return normalized || null;
}

function identifierMap(input: IdentityCandidate) {
  return new Map(
    (input.identifiers ?? [])
      .map((item) => [item.type, normalize(item.value)] as const)
      .filter(([, value]) => value !== null),
  );
}

function same(a: string | null | undefined, b: string | null | undefined) {
  const left = normalize(a);
  const right = normalize(b);
  return left !== null && right !== null && left === right;
}

function addPairEvidence(
  evidence: IdentityEvidence[],
  field: string,
  candidate: string | number | null,
  master: string | number | null,
  reason: string,
) {
  if (candidate == null || master == null) {
    evidence.push({ field, candidate, master, result: "MISSING", reason });
    return;
  }
  evidence.push({
    field,
    candidate,
    master,
    result: String(candidate) === String(master) ? "MATCH" : "MISMATCH",
    reason,
  });
}

export function matchProductIdentity(
  candidate: IdentityCandidate,
  master: IdentityCandidate,
): IdentityMatchResult {
  const evidence: IdentityEvidence[] = [];
  const hardBlockReasons: string[] = [];
  const candidateIds = identifierMap(candidate);
  const masterIds = identifierMap(master);

  const variantFields = ["color", "size", "capacity", "generation", "condition"] as const;
  for (const field of variantFields) {
    const left = candidate[field];
    const right = master[field];
    if (left == null || right == null) {
      addPairEvidence(evidence, field, left ?? null, right ?? null, "Unknown variant data cannot be guessed.");
    } else if (!same(String(left), String(right))) {
      addPairEvidence(evidence, field, left, right, "Known variant contradiction is a hard block.");
      hardBlockReasons.push(field.toUpperCase() + "_MISMATCH");
    } else {
      addPairEvidence(evidence, field, left, right, "Known variant matches exactly.");
    }
  }

  const leftSet = candidate.setCount ?? null;
  const rightSet = master.setCount ?? null;
  if (leftSet == null || rightSet == null) {
    addPairEvidence(evidence, "set_count", leftSet, rightSet, "Set count is blocking only when both values are known.");
  } else if (leftSet !== rightSet) {
    addPairEvidence(evidence, "set_count", leftSet, rightSet, "Set count contradiction is a hard block.");
    hardBlockReasons.push("SET_COUNT_MISMATCH");
  } else {
    addPairEvidence(evidence, "set_count", leftSet, rightSet, "Set count matches exactly.");
  }

  for (const type of GLOBAL_IDENTIFIERS) {
    const left = candidateIds.get(type) ?? null;
    const right = masterIds.get(type) ?? null;
    if (left == null || right == null) {
      addPairEvidence(evidence, type, left, right, "Strong identifier is missing on one side; never infer it.");
    } else if (left !== right) {
      addPairEvidence(evidence, type, left, right, "Strong identifier contradiction is a hard block.");
      hardBlockReasons.push(type + "_MISMATCH");
    } else {
      addPairEvidence(evidence, type, left, right, "Strong identifier matches exactly.");
    }
  }

  const candidateMpn = candidateIds.get("MPN") ?? null;
  const masterMpn = masterIds.get("MPN") ?? null;
  if (candidateMpn == null || masterMpn == null) {
    addPairEvidence(evidence, "MPN", candidateMpn, masterMpn, "MPN/model evidence is not guessed when missing.");
  } else if (candidateMpn !== masterMpn) {
    addPairEvidence(evidence, "MPN", candidateMpn, masterMpn, "MPN/model contradiction is a hard block.");
    hardBlockReasons.push("MPN_MISMATCH");
  } else {
    addPairEvidence(evidence, "MPN", candidateMpn, masterMpn, "MPN/model matches exactly.");
  }

  if (hardBlockReasons.length > 0) {
    return {
      decision: "BLOCK",
      matchMethod: "NONE",
      hardBlockReasons: [...new Set(hardBlockReasons)],
      evidence,
    };
  }

  const exactGlobal = GLOBAL_IDENTIFIERS.some((type) => {
    const left = candidateIds.get(type);
    const right = masterIds.get(type);
    return Boolean(left && right && left === right);
  });

  const brandMatch = same(candidate.brand, master.brand);
  if (candidate.modelNumber && master.modelNumber) {
    addPairEvidence(
      evidence,
      "model_number",
      normalize(candidate.modelNumber),
      normalize(master.modelNumber),
      "Model number alone never promotes a candidate to AUTO_LINK.",
    );
  }
  const mpnMatch = Boolean(candidateMpn && masterMpn && candidateMpn === masterMpn);

  if (exactGlobal || (mpnMatch && brandMatch)) {
    return {
      decision: "AUTO_LINK",
      matchMethod: "STRONG",
      hardBlockReasons: [],
      evidence,
    };
  }

  if (candidate.title && master.title) {
    evidence.push({
      field: "title",
      candidate: normalize(candidate.title),
      master: normalize(master.title),
      result: "WEAK",
      reason: "Title similarity can surface a candidate, but can never promote it to AUTO_LINK.",
    });
  }

  return {
    decision: "REVIEW",
    matchMethod: "WEAK",
    hardBlockReasons: [],
    evidence,
  };
}

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

const GLOBAL_IDENTIFIERS = ["JAN", "EAN", "UPC"] as const;
type GlobalIdentifierType = (typeof GLOBAL_IDENTIFIERS)[number];

export function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");
  return normalized || null;
}

export function normalizeIdentifier(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  return normalized ? normalized.replace(/[\s-]/g, "") : null;
}

function identifierMap(input: IdentityCandidate) {
  const values = new Map<IdentifierType, string[]>();
  for (const item of input.identifiers ?? []) {
    const value = normalizeIdentifier(item.value);
    if (!value) continue;
    const current = values.get(item.type) ?? [];
    if (!current.includes(value)) current.push(value);
    values.set(item.type, current);
  }
  return values;
}

function identifierValue(map: Map<IdentifierType, string[]>, type: IdentifierType) {
  const values = map.get(type) ?? [];
  return values.length === 1 ? values[0] : null;
}

function hasIdentifierConflict(map: Map<IdentifierType, string[]>, type: IdentifierType) {
  return (map.get(type) ?? []).length > 1;
}

function isValidCheckDigit(value: string, type: GlobalIdentifierType) {
  if (!/^\d+$/.test(value)) return false;
  const expectedLength = type === "UPC" ? 12 : 13;
  if (value.length !== expectedLength) return false;
  const digits = [...value].map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const fromRight = digits.length - 1 - i;
    sum += digits[i] * (fromRight % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

function isValidGlobalIdentifier(value: string, type: "JAN" | "EAN" | "UPC") {
  return isValidCheckDigit(value, type);
}

function same(a: string | null | undefined, b: string | null | undefined) {
  const left = normalizeText(a);
  const right = normalizeText(b);
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
  const equal = typeof candidate === "string" && typeof master === "string"
    ? same(candidate, master)
    : String(candidate) === String(master);
  evidence.push({ field, candidate, master, result: equal ? "MATCH" : "MISMATCH", reason });
}

export function matchProductIdentity(
  candidate: IdentityCandidate,
  master: IdentityCandidate,
): IdentityMatchResult {
  const evidence: IdentityEvidence[] = [];
  const hardBlockReasons: string[] = [];
  let hasInvalidGlobalIdentifier = false;
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
    const left = identifierValue(candidateIds, type);
    const right = identifierValue(masterIds, type);
    if (left == null || right == null) {
      addPairEvidence(evidence, type, left, right, "Strong identifier is missing on one side; never infer it.");
    } else if (!isValidGlobalIdentifier(left, type) || !isValidGlobalIdentifier(right, type)) {
      hasInvalidGlobalIdentifier = true;
      addPairEvidence(evidence, type, left, right, "Identifier format/check digit is invalid; treat it as untrusted evidence and REVIEW rather than hard-blocking on its value.");
    } else if (left !== right) {
      addPairEvidence(evidence, type, left, right, "Two valid strong identifiers contradict each other; this is a hard block.");
      hardBlockReasons.push(type + "_MISMATCH");
    } else {
      addPairEvidence(evidence, type, left, right, "Strong identifier matches exactly and passes check-digit validation.");
    }
  }

  const candidateMpn = identifierValue(candidateIds, "MPN");
  const masterMpn = identifierValue(masterIds, "MPN");
  if (candidateMpn == null || masterMpn == null) {
    addPairEvidence(evidence, "MPN", candidateMpn, masterMpn, "MPN/model evidence is not guessed when missing.");
  } else if (candidateMpn !== masterMpn) {
    addPairEvidence(evidence, "MPN", candidateMpn, masterMpn, "MPN/model contradiction is a hard block.");
    hardBlockReasons.push("MPN_MISMATCH");
  } else {
    addPairEvidence(evidence, "MPN", candidateMpn, masterMpn, "MPN/model matches exactly.");
  }

  for (const type of ["JAN", "EAN", "UPC", "MPN"] as const) {
    if (hasIdentifierConflict(candidateIds, type) || hasIdentifierConflict(masterIds, type)) {
      hardBlockReasons.push(type + "_CONFLICT");
      evidence.push({
        field: type,
        candidate: (candidateIds.get(type) ?? []).join(" | ") || null,
        master: (masterIds.get(type) ?? []).join(" | ") || null,
        result: "MISMATCH",
        reason: "Multiple distinct strong identifiers of the same type are ambiguous; stop instead of choosing one.",
      });
    }
  }

  if (hardBlockReasons.length > 0) {
    return { decision: "BLOCK", matchMethod: "NONE", hardBlockReasons: [...new Set(hardBlockReasons)], evidence };
  }

  const exactGlobal = GLOBAL_IDENTIFIERS.some((type) => {
    const left = identifierValue(candidateIds, type);
    const right = identifierValue(masterIds, type);
    return Boolean(left && right && left === right && isValidGlobalIdentifier(left, type));
  });

  const brandMatch = same(candidate.brand, master.brand);
  if (candidate.modelNumber && master.modelNumber) {
    addPairEvidence(evidence, "model_number", candidate.modelNumber, master.modelNumber, "Model number alone never promotes a candidate to AUTO_LINK.");
  }
  const mpnMatch = Boolean(candidateMpn && masterMpn && candidateMpn === masterMpn);

  if (exactGlobal || (mpnMatch && brandMatch && !hasInvalidGlobalIdentifier)) {
    return { decision: "AUTO_LINK", matchMethod: "STRONG", hardBlockReasons: [], evidence };
  }

  if (candidate.title && master.title) {
    evidence.push({
      field: "title",
      candidate: normalizeText(candidate.title),
      master: normalizeText(master.title),
      result: "WEAK",
      reason: "Title similarity can surface a candidate, but can never promote it to AUTO_LINK.",
    });
  }

  return { decision: "REVIEW", matchMethod: "WEAK", hardBlockReasons: [], evidence };
}

export type IdentifierType =
  | "JAN" | "EAN" | "UPC" | "MPN" | "SKU" | "SUPPLIER_PRODUCT_NO";

export type ProductIdentifier = { type: IdentifierType; value: string };

export type IdentityCandidate = {
  brand?: string | null;
  modelNumber?: string | null;
  identifiers?: ProductIdentifier[];
  color?: string | null;
  size?: string | null;
  capacity?: string | null;
  generation?: string | null;
  setCount?: number | null;
  condition?: string | null;
};

export type IdentityMatchDecision = "AUTO_LINK" | "REVIEW" | "BLOCK" | "REJECT";

export type IdentityEvidence = {
  field: string;
  candidate: string | number | null;
  master: string | number | null;
  result: "MATCH" | "MISMATCH";
  weight: number;
};

export type IdentityMatchResult = {
  decision: IdentityMatchDecision;
  confidence: number;
  hardBlockReasons: string[];
  evidence: IdentityEvidence[];
};

const GLOBAL_IDENTIFIERS: IdentifierType[] = ["JAN", "EAN", "UPC"];

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFKC").trim().toUpperCase().replace(/[\\s-]/g, "");
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

function variantMismatch(
  candidate: IdentityCandidate,
  master: IdentityCandidate,
  field: "color" | "size" | "capacity" | "generation" | "setCount" | "condition",
) {
  const left = candidate[field];
  const right = master[field];
  if (left == null || right == null) return false;
  if (field === "setCount") return left !== right;
  return !same(String(left), String(right));
}

export function matchProductIdentity(
  candidate: IdentityCandidate,
  master: IdentityCandidate,
): IdentityMatchResult {
  const evidence: IdentityEvidence[] = [];
  const hardBlockReasons: string[] = [];
  const candidateIds = identifierMap(candidate);
  const masterIds = identifierMap(master);

  for (const field of ["color", "size", "capacity", "generation", "setCount", "condition"] as const) {
    if (variantMismatch(candidate, master, field)) {
      hardBlockReasons.push(field.toUpperCase() + "_MISMATCH");
      evidence.push({
        field,
        candidate: candidate[field] ?? null,
        master: master[field] ?? null,
        result: "MISMATCH",
        weight: 1,
      });
    }
  }

  for (const type of GLOBAL_IDENTIFIERS) {
    const left = candidateIds.get(type);
    const right = masterIds.get(type);
    if (left && right) {
      evidence.push({
        field: type,
        candidate: left,
        master: right,
        result: left === right ? "MATCH" : "MISMATCH",
        weight: 1,
      });
      if (left !== right) hardBlockReasons.push(type + "_MISMATCH");
    }
  }

  const candidateMpn = candidateIds.get("MPN");
  const masterMpn = masterIds.get("MPN");
  const brandMatch = same(candidate.brand, master.brand);
  const mpnMatch = Boolean(candidateMpn && masterMpn && candidateMpn === masterMpn);

  if (candidate.brand != null && master.brand != null) {
    evidence.push({
      field: "brand",
      candidate: candidate.brand,
      master: master.brand,
      result: brandMatch ? "MATCH" : "MISMATCH",
      weight: 0.8,
    });
  }

  if (candidateMpn && masterMpn) {
    evidence.push({
      field: "MPN",
      candidate: candidateMpn,
      master: masterMpn,
      result: mpnMatch ? "MATCH" : "MISMATCH",
      weight: 0.95,
    });
    if (!mpnMatch) hardBlockReasons.push("MPN_MISMATCH");
  }

  if (hardBlockReasons.length > 0) {
    return {
      decision: "BLOCK",
      confidence: 1,
      hardBlockReasons: [...new Set(hardBlockReasons)],
      evidence,
    };
  }

  const exactGlobal = GLOBAL_IDENTIFIERS.some((type) => {
    const left = candidateIds.get(type);
    const right = masterIds.get(type);
    return Boolean(left && right && left === right);
  });

  if (exactGlobal || (mpnMatch && brandMatch)) {
    return {
      decision: "AUTO_LINK",
      confidence: exactGlobal ? 1 : 0.98,
      hardBlockReasons: [],
      evidence,
    };
  }

  const modelMatch = same(candidate.modelNumber, master.modelNumber);
  if (modelMatch && brandMatch) {
    evidence.push({
      field: "modelNumber",
      candidate: candidate.modelNumber ?? null,
      master: master.modelNumber ?? null,
      result: "MATCH",
      weight: 0.9,
    });
    return {
      decision: "AUTO_LINK",
      confidence: 0.95,
      hardBlockReasons: [],
      evidence,
    };
  }

  return {
    decision: "REVIEW",
    confidence: 0,
    hardBlockReasons: [],
    evidence,
  };
}

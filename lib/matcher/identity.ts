export type MatchDecision = "AUTO_LINK" | "REVIEW" | "BLOCK";

export type IdentityIdentifier = {
  type: "JAN" | "EAN" | "UPC" | "MPN" | "SKU" | "SUPPLIER_PRODUCT_NO";
  value: string;
};

export type IdentityRecord = {
  id: string;
  brand?: string | null;
  modelNumber?: string | null;
  identifiers?: Array<{
    type: "JAN" | "EAN" | "UPC" | "MPN" | "SKU" | "SUPPLIER_PRODUCT_NO";
    value: string;
  }>;
  variant?: {
    color?: string | null;
    size?: string | null;
    capacity?: string | null;
    generation?: string | null;
    setCount?: number | null;
    condition?: string | null;
  } | null;
};

export type MatchEvidence = {
  field: string;
  kind: "EXACT_IDENTIFIER" | "EXACT_ATTRIBUTE" | "VARIANT_COMPATIBLE" | "VARIANT_CONFLICT" | "ATTRIBUTE_CONFLICT";
  source: string | null;
  master: string | null;
  weight: number;
};

export type IdentityMatch = {
  decision: MatchDecision;
  masterProductId: string | null;
  confidence: number;
  reasons: string[];
  evidence: MatchEvidence[];
};

const GTIN_TYPES = new Set(["JAN", "EAN", "UPC"]);
const VARIANT_FIELDS = ["color", "size", "capacity", "generation", "setCount", "condition"] as const;

function compact(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().toUpperCase().replace(/[\s\-_/.,()[\]{}:]+/g, "");
}

function normalizeIdentifier(type: IdentityIdentifier["type"], value: string): string {
  const normalized = compact(value);
  return GTIN_TYPES.has(type) ? normalized.replace(/\D/g, "") : normalized;
}

function validGtin(value: string): boolean {
  if (!/^\d+$/.test(value) || ![12, 13, 14].includes(value.length)) return false;
  let sum = 0;
  for (let i = value.length - 2, position = 0; i >= 0; i--, position++) {
    sum += Number(value[i]) * (position % 2 === 0 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(value[value.length - 1]);
}

function identifierMap(record: IdentityRecord): Map<string, string> {
  return new Map((record.identifiers ?? []).map((item) => [
    item.type,
    normalizeIdentifier(item.type, item.value),
  ]));
}

function variantConflicts(source: IdentityRecord["variant"], master: IdentityRecord["variant"]): string[] {
  if (!source || !master) return [];
  return VARIANT_FIELDS.filter((field) => {
    const a = source[field];
    const b = master[field];
    return a !== null && a !== undefined && b !== null && b !== undefined &&
      compact(String(a)) !== compact(String(b));
  });
}

function evidenceFor(source: IdentityRecord, master: IdentityRecord): MatchEvidence[] {
  const evidence: MatchEvidence[] = [];
  const sourceIds = identifierMap(source);
  const masterIds = identifierMap(master);

  for (const type of GTIN_TYPES) {
    const a = sourceIds.get(type);
    const b = masterIds.get(type);
    if (a && b && a === b && validGtin(a)) {
      evidence.push({ field: type, kind: "EXACT_IDENTIFIER", source: a, master: b, weight: 1 });
    }
  }

  if (source.brand && master.brand) {
    if (compact(source.brand) === compact(master.brand)) {
      evidence.push({ field: "brand", kind: "EXACT_ATTRIBUTE", source: source.brand, master: master.brand, weight: 0.25 });
    } else {
      evidence.push({ field: "brand", kind: "ATTRIBUTE_CONFLICT", source: source.brand, master: master.brand, weight: -1 });
    }
  }
  if (source.modelNumber && master.modelNumber) {
    if (compact(source.modelNumber) === compact(master.modelNumber)) {
      evidence.push({ field: "modelNumber", kind: "EXACT_ATTRIBUTE", source: source.modelNumber, master: master.modelNumber, weight: 0.45 });
    } else {
      evidence.push({ field: "modelNumber", kind: "ATTRIBUTE_CONFLICT", source: source.modelNumber, master: master.modelNumber, weight: -1 });
    }
  }

  const conflicts = variantConflicts(source.variant, master.variant);
  for (const field of conflicts) {
    evidence.push({
      field,
      kind: "VARIANT_CONFLICT",
      source: String(source.variant?.[field]),
      master: String(master.variant?.[field]),
      weight: -1,
    });
  }

  if (conflicts.length === 0 && source.variant && master.variant) {
    evidence.push({ field: "variant", kind: "VARIANT_COMPATIBLE", source: null, master: null, weight: 0.1 });
  }

  return evidence;
}

function score(source: IdentityRecord, master: IdentityRecord, evidence: MatchEvidence[]): number {
  const gtin = evidence.some((item) => item.kind === "EXACT_IDENTIFIER");
  const brand = evidence.some((item) => item.field === "brand");
  const model = evidence.some((item) => item.field === "modelNumber");
  if (gtin) return 1;
  let value = 0.2;
  if (brand) value += 0.25;
  if (model) value += 0.45;
  if (source.variant && master.variant && variantConflicts(source.variant, master.variant).length === 0) value += 0.1;
  return Math.min(0.99, value);
}

export function matchIdentity(source: IdentityRecord, candidates: IdentityRecord[]): IdentityMatch {
  const sourceIds = identifierMap(source);
  const invalidGtin = [...sourceIds.entries()].some(([type, value]) => GTIN_TYPES.has(type) && value.length > 0 && !validGtin(value));
  if (invalidGtin) {
    return { decision: "REVIEW", masterProductId: null, confidence: 0, reasons: ["INVALID_GTIN"], evidence: [] };
  }

  const evaluated = candidates.map((master) => {
    const evidence = evidenceFor(source, master);
    const conflicts = evidence.filter((item) => item.kind === "VARIANT_CONFLICT" || item.kind === "ATTRIBUTE_CONFLICT");
    const confidence = score(source, master, evidence);
    const exactGtin = evidence.some((item) => item.kind === "EXACT_IDENTIFIER");
    const brandExact = evidence.some((item) => item.field === "brand");
    const modelExact = evidence.some((item) => item.field === "modelNumber");
    const hardBlock = conflicts.length > 0;

    const eligible = !hardBlock && (
      exactGtin ||
      (brandExact && modelExact && confidence >= 0.9)
    );

    return { master, evidence, confidence, hardBlock, eligible };
  }).sort((a, b) => b.confidence - a.confidence);

  if (evaluated.length === 0) {
    return { decision: "REVIEW", masterProductId: null, confidence: 0, reasons: ["NO_CANDIDATE"], evidence: [] };
  }

  const top = evaluated[0];
  const tied = evaluated.filter((item) => item.confidence === top.confidence);
  if (top.hardBlock && top.confidence >= 0.9) {
    return {
      decision: "BLOCK",
      masterProductId: top.master.id,
      confidence: top.confidence,
      reasons: [top.evidence.some((item) => item.kind === "ATTRIBUTE_CONFLICT") ? "IDENTITY_ATTRIBUTE_CONFLICT" : "VARIANT_CONFLICT"],
      evidence: top.evidence,
    };
  }

  if (tied.length > 1 && top.confidence > 0) {
    return {
      decision: "REVIEW",
      masterProductId: null,
      confidence: top.confidence,
      reasons: ["AMBIGUOUS_CANDIDATES"],
      evidence: top.evidence,
    };
  }

  if (top.eligible) {
    return {
      decision: "AUTO_LINK",
      masterProductId: top.master.id,
      confidence: top.confidence,
      reasons: ["SUFFICIENT_IDENTITY_EVIDENCE"],
      evidence: top.evidence,
    };
  }

  return {
    decision: "REVIEW",
    masterProductId: null,
    confidence: top.confidence,
    reasons: top.hardBlock
      ? [top.evidence.some((item) => item.kind === "ATTRIBUTE_CONFLICT") ? "IDENTITY_ATTRIBUTE_CONFLICT" : "VARIANT_CONFLICT"]
      : ["INSUFFICIENT_IDENTITY_EVIDENCE"],
    evidence: top.evidence,
  };
}

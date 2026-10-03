import { compact, matchIdentity, normalizeIdentifier, validGtin, type IdentityMatch, type IdentityRecord } from "./identity.ts";

export type StoredIdentityMatch = {
  decision: "AUTO_LINK" | "REVIEW" | "BLOCK" | "REJECT";
  masterProductId: string | null;
  hardBlock: boolean;
};

export type IdentityMatchRow = {
  master_product_id: string | null;
  confidence: number;
  decision: "AUTO_LINK" | "REVIEW" | "BLOCK";
  hard_block: boolean;
};

export function toIdentityMatchRow(result: IdentityMatch): IdentityMatchRow {
  const hardBlock = result.decision === "BLOCK";
  return {
    master_product_id: result.masterProductId,
    confidence: Math.max(0, Math.min(1, Math.round(result.confidence * 10000) / 10000)),
    decision: result.decision,
    hard_block: hardBlock,
  };
}

/**
 * Decides what the automatic matcher should append to identity_match.
 * identity_match is append-only and the newest row per supplier product wins.
 *
 * - No previous row: write the computed result.
 * - Same decision/master/hard_block: write nothing (no duplicate rows per run).
 * - A REJECT is a human decision: never overridden automatically.
 * - A newly detected hard conflict (BLOCK) always wins; safety first.
 * - REVIEW → AUTO_LINK: evidence improved, write it.
 * - AUTO_LINK → AUTO_LINK to a different master: ambiguous, downgrade to REVIEW.
 * - AUTO_LINK → REVIEW: keep the existing link (it may be a human confirmation);
 *   real variant/attribute conflicts surface as BLOCK, not REVIEW. Exception: `force`
 *   (the master itself is no longer approved/active) is always recorded.
 * - REVIEW → REVIEW pointing at a newly proposed candidate master: recorded.
 */
export function planIdentityWrite(previous: StoredIdentityMatch | null, computed: IdentityMatchRow, options: { force?: boolean } = {}): IdentityMatchRow | null {
  if (!previous) return computed;
  if (
    previous.decision === computed.decision &&
    previous.masterProductId === computed.master_product_id &&
    previous.hardBlock === computed.hard_block
  ) return null;
  if (previous.decision === "REJECT") return null;
  // Safety downgrades (e.g. the linked master was deactivated or rejected) are always recorded.
  if (options.force) return computed;
  if (computed.decision === "BLOCK") return computed;
  if (computed.decision === "AUTO_LINK") {
    if (previous.decision === "AUTO_LINK" && previous.masterProductId !== computed.master_product_id) {
      if (previous.masterProductId === null) return computed;
      return { master_product_id: null, confidence: computed.confidence, decision: "REVIEW", hard_block: false };
    }
    if (previous.decision === "AUTO_LINK") return null;
    return computed;
  }
  // computed REVIEW
  if (previous.decision === "AUTO_LINK" && !previous.hardBlock) return null;
  if (previous.decision === "REVIEW") {
    // Record that a REVIEW now points at a (candidate) master; otherwise nothing new to say.
    return computed.master_product_id && computed.master_product_id !== previous.masterProductId ? computed : null;
  }
  // previous BLOCK → REVIEW: the conflict disappeared from the data; record it so the block is not stale.
  return computed;
}

/* ------------------------------------------------------------------ */
/* Resolution: which of the three master-product patterns applies      */
/* ------------------------------------------------------------------ */

export type MasterInfo = {
  status: "ACTIVE" | "INACTIVE";
  approvalStatus: "CANDIDATE" | "APPROVED" | "REJECTED";
  originSupplierProductId: string | null;
};

export type CandidateProposal = {
  productName: string;
  brand: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  gtins: Array<{ type: "JAN" | "EAN" | "UPC"; value: string; normalized: string }>;
  variant: NonNullable<IdentityRecord["variant"]> | null;
};

export type IdentityPattern =
  | "A_LINK"              // strong evidence to an approved, active master → AUTO_LINK
  | "A_MASTER_NOT_READY"  // strong evidence, but the master is a candidate / rejected / inactive → REVIEW
  | "B_NEW_CANDIDATE"     // no master, strong identifiers → propose a CANDIDATE master, link as REVIEW
  | "B_INSUFFICIENT"      // no master and not enough to propose one → REVIEW, nothing created
  | "C_CONFLICT"          // variant / attribute conflict with a master → BLOCK (hard_block)
  | "AMBIGUOUS";          // several equally good masters → REVIEW

export type IdentityResolution = {
  pattern: IdentityPattern;
  result: IdentityMatch;
  row: IdentityMatchRow;
  proposal: CandidateProposal | null;
  /** Safety downgrade (master no longer approved/active): must be recorded even over an AUTO_LINK. */
  forceWrite: boolean;
};

export type SupplierIdentity = IdentityRecord & { productName?: string | null; manufacturer?: string | null };

const GTIN = new Set(["JAN", "EAN", "UPC"]);
const PROPOSABLE_REASONS = new Set(["NO_CANDIDATE", "INSUFFICIENT_IDENTITY_EVIDENCE", "IDENTITY_ATTRIBUTE_CONFLICT"]);

export function isMasterSellable(info: MasterInfo | undefined) {
  return !!info && info.status === "ACTIVE" && info.approvalStatus === "APPROVED";
}

export function resolveIdentity(source: SupplierIdentity, candidates: IdentityRecord[], masters: Map<string, MasterInfo>): IdentityResolution {
  const result = matchIdentity(source, candidates);

  if (result.decision === "AUTO_LINK" && result.masterProductId) {
    const info = masters.get(result.masterProductId);
    if (isMasterSellable(info)) {
      return { pattern: "A_LINK", result, row: toIdentityMatchRow(result), proposal: null, forceWrite: false };
    }
    const reason = !info ? "MASTER_UNKNOWN"
      : info.approvalStatus === "CANDIDATE" ? "MASTER_PENDING_APPROVAL"
      : info.approvalStatus === "REJECTED" ? "MASTER_REJECTED"
      : "MASTER_INACTIVE";
    const capped: IdentityMatch = { ...result, decision: "REVIEW", reasons: [reason] };
    return { pattern: "A_MASTER_NOT_READY", result: capped, row: toIdentityMatchRow(capped), proposal: null, forceWrite: true };
  }
  if (result.decision === "BLOCK") {
    return { pattern: "C_CONFLICT", result, row: toIdentityMatchRow(result), proposal: null, forceWrite: false };
  }
  if (result.reasons.includes("AMBIGUOUS_CANDIDATES")) {
    return { pattern: "AMBIGUOUS", result, row: toIdentityMatchRow(result), proposal: null, forceWrite: false };
  }

  const insufficient = (reason: string): IdentityResolution => {
    const r: IdentityMatch = { ...result, masterProductId: null, reasons: [...result.reasons, reason] };
    return { pattern: "B_INSUFFICIENT", result: r, row: toIdentityMatchRow(r), proposal: null, forceWrite: false };
  };
  if (result.masterProductId || !result.reasons.some((reason) => PROPOSABLE_REASONS.has(reason))) return insufficient("NOT_PROPOSABLE");

  const productName = (source.productName ?? "").trim();
  if (!productName) return insufficient("CANDIDATE_NEEDS_PRODUCT_NAME");
  const gtins = (source.identifiers ?? [])
    .filter((id) => GTIN.has(id.type))
    .map((id) => ({ type: id.type as "JAN" | "EAN" | "UPC", value: id.value.trim(), normalized: normalizeIdentifier(id.type, id.value) }))
    .filter((id) => validGtin(id.normalized));
  const brand = source.brand?.trim() || null;
  const modelNumber = source.modelNumber?.trim() || null;
  // "No master exists" is never evidence by itself: a proposal needs a valid GTIN or brand + model number.
  if (gtins.length === 0 && !(brand && modelNumber)) return insufficient("CANDIDATE_NEEDS_STRONG_IDENTIFIER");

  for (const [, info] of masters) {
    if (info.originSupplierProductId === source.id) return insufficient("CANDIDATE_ALREADY_PROPOSED");
  }
  const sourceGtins = new Set(gtins.map((id) => id.normalized.padStart(14, "0")));
  const modelKey = modelNumber ? compact(modelNumber) : null;
  for (const master of candidates) {
    if ((master.identifiers ?? []).some((id) => GTIN.has(id.type) && sourceGtins.has(normalizeIdentifier(id.type, id.value).padStart(14, "0")))) {
      return insufficient("POSSIBLE_DUPLICATE_MASTER");
    }
    if (modelKey && master.modelNumber && compact(master.modelNumber) === modelKey) return insufficient("POSSIBLE_DUPLICATE_MASTER");
  }

  const proposal: CandidateProposal = {
    productName,
    brand,
    manufacturer: source.manufacturer?.trim() || null,
    modelNumber,
    gtins,
    variant: source.variant ?? null,
  };
  const r: IdentityMatch = { ...result, decision: "REVIEW", masterProductId: null, reasons: ["MASTER_CANDIDATE_PROPOSED"] };
  return { pattern: "B_NEW_CANDIDATE", result: r, row: toIdentityMatchRow(r), proposal, forceWrite: false };
}

import type { IdentityMatch } from "./identity.ts";

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
 *   real variant/attribute conflicts surface as BLOCK, not REVIEW.
 */
export function planIdentityWrite(previous: StoredIdentityMatch | null, computed: IdentityMatchRow): IdentityMatchRow | null {
  if (!previous) return computed;
  if (
    previous.decision === computed.decision &&
    previous.masterProductId === computed.master_product_id &&
    previous.hardBlock === computed.hard_block
  ) return null;
  if (previous.decision === "REJECT") return null;
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
  if (previous.decision === "REVIEW") return null;
  // previous BLOCK → REVIEW: the conflict disappeared from the data; record it so the block is not stale.
  return computed;
}

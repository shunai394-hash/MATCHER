import {
  type IdentityCandidate,
  type IdentityMatchResult,
  matchProductIdentity,
} from "./identity.ts";

export type MasterResolution =
  | { decision: "AUTO_LINK"; masterIndex: number; match: IdentityMatchResult }
  | { decision: "REVIEW"; masterIndex: null; reason: "NO_STRONG_MATCH" | "AMBIGUOUS_STRONG_MATCH"; matches: Array<{ masterIndex: number; match: IdentityMatchResult }> }
  | { decision: "BLOCK"; masterIndex: null; reason: "ALL_CANDIDATES_BLOCKED" };

export function resolveProductMaster(
  candidate: IdentityCandidate,
  masters: IdentityCandidate[],
): MasterResolution {
  const matches = masters.map((master, masterIndex) => ({
    masterIndex,
    match: matchProductIdentity(candidate, master),
  }));

  const strong = matches.filter(({ match }) => match.decision === "AUTO_LINK" && match.matchMethod === "STRONG");

  if (strong.length === 1) {
    return { decision: "AUTO_LINK", masterIndex: strong[0].masterIndex, match: strong[0].match };
  }

  if (strong.length > 1) {
    return {
      decision: "REVIEW",
      masterIndex: null,
      reason: "AMBIGUOUS_STRONG_MATCH",
      matches: strong,
    };
  }

  if (matches.length > 0 && matches.every(({ match }) => match.decision === "BLOCK")) {
    return { decision: "BLOCK", masterIndex: null, reason: "ALL_CANDIDATES_BLOCKED" };
  }

  return {
    decision: "REVIEW",
    masterIndex: null,
    reason: "NO_STRONG_MATCH",
    matches: matches.filter(({ match }) => match.decision !== "BLOCK"),
  };
}

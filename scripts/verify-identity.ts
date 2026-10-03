import { strict as assert } from "node:assert";
import { planIdentityWrite, resolveIdentity, toIdentityMatchRow, type MasterInfo, type StoredIdentityMatch } from "../lib/matcher/identity-sync.ts";
import type { IdentityRecord } from "../lib/matcher/identity.ts";

/**
 * Identity resolution + identity_match write rules (what syncIdentityMatches applies per supplier product).
 */

function gtin13(prefix12: string) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(prefix12[i]) * (i % 2 === 0 ? 1 : 3);
  return prefix12 + ((10 - (sum % 10)) % 10);
}
const JAN = gtin13("490123456789");
const JAN2 = gtin13("490000000777");

const approved: MasterInfo = { status: "ACTIVE", approvalStatus: "APPROVED", originSupplierProductId: null };
const masters = (entries: Array<[string, MasterInfo]>) => new Map(entries);
const master = (id: string, extra: Partial<IdentityRecord> = {}): IdentityRecord => ({ id, brand: "ACME", modelNumber: "AX-204", identifiers: [{ type: "JAN", value: JAN }], ...extra });
const supplier = (extra: Partial<IdentityRecord> & { productName?: string | null } = {}) => ({ id: "sp-1", productName: "ACME AX-204", brand: "ACME", modelNumber: "AX-204", identifiers: [{ type: "JAN" as const, value: JAN }], ...extra });

// Pattern A: strong identifier to an approved, active master → AUTO_LINK.
const a = resolveIdentity(supplier(), [master("m1")], masters([["m1", approved]]));
assert.equal(a.pattern, "A_LINK");
assert.equal(a.row.decision, "AUTO_LINK");
assert.equal(a.row.master_product_id, "m1");
assert.equal(a.row.hard_block, false);

// Pattern A, but the master is only a candidate / rejected / inactive → REVIEW (never AUTO_LINK), forced write.
for (const [info, reason] of [
  [{ ...approved, status: "INACTIVE", approvalStatus: "CANDIDATE" }, "MASTER_PENDING_APPROVAL"],
  [{ ...approved, status: "INACTIVE", approvalStatus: "REJECTED" }, "MASTER_REJECTED"],
  [{ ...approved, status: "INACTIVE" }, "MASTER_INACTIVE"],
] as Array<[MasterInfo, string]>) {
  const r = resolveIdentity(supplier(), [master("m1")], masters([["m1", info]]));
  assert.equal(r.pattern, "A_MASTER_NOT_READY");
  assert.equal(r.row.decision, "REVIEW");
  assert.equal(r.row.master_product_id, "m1");
  assert.deepEqual(r.result.reasons, [reason]);
  assert.equal(r.forceWrite, true);
}

// Pattern B: no master at all, valid JAN + name → propose a candidate, linked only as REVIEW.
const b = resolveIdentity(supplier({ variant: { color: "BLACK" } }), [], masters([]));
assert.equal(b.pattern, "B_NEW_CANDIDATE");
assert.equal(b.row.decision, "REVIEW", "an empty master table must never produce AUTO_LINK");
assert.deepEqual(b.proposal?.gtins.map((g) => g.normalized), [JAN]);
assert.deepEqual(b.proposal?.variant, { color: "BLACK" });
// brand + model number is also strong enough to propose.
assert.equal(resolveIdentity(supplier({ identifiers: [] }), [], masters([])).pattern, "B_NEW_CANDIDATE");

// Pattern B guards: nothing created without strong identifiers, a name, or when a duplicate is likely.
const noIds = resolveIdentity(supplier({ identifiers: [], modelNumber: null }), [], masters([]));
assert.equal(noIds.pattern, "B_INSUFFICIENT");
assert.equal(noIds.proposal, null);
assert.ok(noIds.result.reasons.includes("CANDIDATE_NEEDS_STRONG_IDENTIFIER"));
assert.equal(resolveIdentity(supplier({ productName: " " }), [], masters([])).pattern, "B_INSUFFICIENT");
const badGtin = resolveIdentity(supplier({ identifiers: [{ type: "JAN", value: "4901234567890" }] }), [], masters([]));
assert.equal(badGtin.pattern, "B_INSUFFICIENT");
assert.equal(badGtin.row.decision, "REVIEW");
// Same model, conflicting brand → possible duplicate: human review, nothing created, never AUTO_LINK.
const sameModelOtherBrand = resolveIdentity(supplier({ brand: "OTHER", identifiers: [{ type: "JAN", value: JAN2 }] }), [master("m1")], masters([["m1", approved]]));
assert.equal(sameModelOtherBrand.pattern, "B_INSUFFICIENT");
assert.equal(sameModelOtherBrand.proposal, null);
assert.ok(sameModelOtherBrand.result.reasons.includes("POSSIBLE_DUPLICATE_MASTER"));
// A completely different product (other brand AND other model) is not a conflict with an unrelated master.
const unrelated = resolveIdentity(supplier({ brand: "NOVA", modelNumber: "NV-10", identifiers: [{ type: "JAN", value: JAN2 }] }), [master("m1")], masters([["m1", approved]]));
assert.equal(unrelated.pattern, "B_NEW_CANDIDATE");
assert.equal(unrelated.row.hard_block, false);
// Same model, unknown brand, different JAN → possible duplicate: human review, nothing created.
const sameModelNoBrand = resolveIdentity(supplier({ brand: null, identifiers: [{ type: "JAN", value: JAN2 }] }), [master("m1")], masters([["m1", approved]]));
assert.equal(sameModelNoBrand.pattern, "B_INSUFFICIENT");
assert.ok(sameModelNoBrand.result.reasons.includes("POSSIBLE_DUPLICATE_MASTER"));
const alreadyProposed = resolveIdentity(supplier({ identifiers: [{ type: "JAN", value: JAN2 }], modelNumber: "ZZ-1" }), [master("m9", { brand: null, modelNumber: null, identifiers: [] })], masters([["m9", { status: "INACTIVE", approvalStatus: "REJECTED", originSupplierProductId: "sp-1" }]]));
assert.ok(alreadyProposed.result.reasons.includes("CANDIDATE_ALREADY_PROPOSED"));

// Pattern C: same JAN but conflicting variant → BLOCK with hard_block (never AUTO_LINK).
const c = resolveIdentity(supplier({ variant: { capacity: "128GB" } }), [master("m1", { variant: { capacity: "256GB" } })], masters([["m1", approved]]));
assert.equal(c.pattern, "C_CONFLICT");
assert.equal(c.row.decision, "BLOCK");
assert.equal(c.row.hard_block, true);

// Ambiguous: two equally good masters → REVIEW, no master chosen.
const amb = resolveIdentity(supplier({ identifiers: [] }), [master("m1", { identifiers: [] }), master("m2", { identifiers: [] })], masters([["m1", approved], ["m2", approved]]));
assert.equal(amb.pattern, "AMBIGUOUS");
assert.equal(amb.row.decision, "REVIEW");
assert.equal(amb.row.master_product_id, null);

// hard_block=true is never paired with AUTO_LINK, whatever the input.
for (const r of [a, b, c, amb, noIds, badGtin]) assert.ok(!(r.row.decision === "AUTO_LINK" && r.row.hard_block));

// Write planning (identity_match is append-only; newest row wins).
const stored = (row: { decision: StoredIdentityMatch["decision"]; master_product_id: string | null; hard_block: boolean }): StoredIdentityMatch =>
  ({ decision: row.decision, masterProductId: row.master_product_id, hardBlock: row.hard_block });
// Same result every run → exactly one insert.
let previous: StoredIdentityMatch | null = null;
let inserts = 0;
for (let run = 0; run < 5; run++) {
  const write = planIdentityWrite(previous, a.row, { force: a.forceWrite });
  if (write) { inserts += 1; previous = stored(write); }
}
assert.equal(inserts, 1, "unchanged results must not be inserted again");
// AUTO_LINK → BLOCK is recorded.
assert.equal(planIdentityWrite(stored(a.row), c.row)?.decision, "BLOCK");
// A human REJECT is never overwritten, not even by a forced downgrade or a new AUTO_LINK.
const reject: StoredIdentityMatch = { decision: "REJECT", masterProductId: "m1", hardBlock: false };
assert.equal(planIdentityWrite(reject, a.row), null);
assert.equal(planIdentityWrite(reject, c.row), null);
assert.equal(planIdentityWrite(reject, a.row, { force: true }), null);
// Master deactivated after linking → forced REVIEW over the old AUTO_LINK.
const downgrade = resolveIdentity(supplier(), [master("m1")], masters([["m1", { ...approved, status: "INACTIVE" }]]));
assert.equal(planIdentityWrite(stored(a.row), downgrade.row, { force: downgrade.forceWrite })?.decision, "REVIEW");
// REVIEW (no master) → REVIEW pointing at the new candidate is recorded once.
const toCandidate = { master_product_id: "cand-1", confidence: 1, decision: "REVIEW" as const, hard_block: false };
assert.deepEqual(planIdentityWrite({ decision: "REVIEW", masterProductId: null, hardBlock: false }, toCandidate), toCandidate);
assert.equal(planIdentityWrite(stored(toCandidate), toCandidate), null);
// Candidate approved → AUTO_LINK recorded.
assert.equal(planIdentityWrite(stored(toCandidate), toIdentityMatchRow({ decision: "AUTO_LINK", masterProductId: "cand-1", confidence: 1, reasons: [], evidence: [] }))?.decision, "AUTO_LINK");

console.log("MATCHER identity resolution verification: PASS");

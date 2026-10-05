import { strict as assert } from "node:assert";
import { matchProductIdentity } from "../lib/matcher/identity.ts";
import { resolveProductMaster } from "../lib/matcher/resolver.ts";

const base = {
  identifiers: [
    { type: "JAN" as const, value: "4901234567894" },
    { type: "MPN" as const, value: "ABC-123" },
  ],
  brand: "Example",
  modelNumber: "ABC-123",
  title: "Example product",
  color: "Black",
  size: "M",
  capacity: "128GB",
  generation: "2",
  setCount: 1,
  condition: "new",
};

const strong = matchProductIdentity(
  { ...base, identifiers: [{ type: "JAN", value: "4901-2345-67894" }, { type: "MPN", value: "ABC-123" }] },
  base,
);
assert.equal(strong.decision, "AUTO_LINK");
assert.equal(strong.matchMethod, "STRONG");

const variantBlock = matchProductIdentity({ ...base, color: "White" }, base);
assert.equal(variantBlock.decision, "BLOCK");
assert.ok(variantBlock.hardBlockReasons.includes("COLOR_MISMATCH"));

const mpnBlock = matchProductIdentity(
  { ...base, identifiers: [{ type: "JAN", value: "4901234567894" }, { type: "MPN", value: "ABC-999" }] },
  base,
);
assert.equal(mpnBlock.decision, "BLOCK");
assert.ok(mpnBlock.hardBlockReasons.includes("MPN_MISMATCH"));

const modelOnlyReview = matchProductIdentity(
  { title: "Example product 128GB Black", brand: "Example", modelNumber: "ABC-123" },
  { title: "Example product", brand: "Example", modelNumber: "ABC-123" },
);
assert.equal(modelOnlyReview.decision, "REVIEW");
assert.equal(modelOnlyReview.matchMethod, "WEAK");

const weakNeverPromotes = matchProductIdentity(
  { title: "Example product 128GB Black", brand: "Example" },
  { title: "Example product", brand: "Example" },
);
assert.equal(weakNeverPromotes.decision, "REVIEW");
assert.equal(weakNeverPromotes.matchMethod, "WEAK");

const duplicateIdentifierBlock = matchProductIdentity(
  { ...base, identifiers: [{ type: "JAN", value: "4901234567894" }, { type: "JAN", value: "4909999999998" }, { type: "MPN", value: "ABC-123" }] },
  base,
);
assert.equal(duplicateIdentifierBlock.decision, "BLOCK");
assert.ok(duplicateIdentifierBlock.hardBlockReasons.includes("JAN_CONFLICT"));

const deterministicA = matchProductIdentity({ ...base }, base);
const deterministicB = matchProductIdentity({ ...base }, base);
assert.deepEqual(deterministicA, deterministicB);

console.log("MATCHER identity verification: PASS");


const invalidGlobal = matchProductIdentity(
  { ...base, identifiers: [{ type: "JAN", value: "4901234567890" }, { type: "MPN", value: "ABC-123" }] },
  base,
);
assert.equal(invalidGlobal.decision, "REVIEW");
assert.ok(invalidGlobal.evidence.some((item) => item.field === "JAN" && item.reason.includes("invalid")));

const conservativeTextNormalization = matchProductIdentity(
  { ...base, color: "Dark   Blue", identifiers: [{ type: "MPN", value: "ABC-123" }] },
  { ...base, color: "Dark Blue", identifiers: [{ type: "MPN", value: "ABC-123" }] },
);
assert.equal(conservativeTextNormalization.decision, "AUTO_LINK");

console.log("MATCHER precision boundary verification: PASS");


const uniqueResolution = resolveProductMaster(base, [
  { ...base, title: "Master A" },
  { ...base, title: "Master B" },
]);
assert.equal(uniqueResolution.decision, "REVIEW");
if (uniqueResolution.decision === "REVIEW") {
  assert.equal(uniqueResolution.reason, "AMBIGUOUS_STRONG_MATCH");
}

const singleResolution = resolveProductMaster(base, [{ ...base, title: "Master A" }]);
assert.equal(singleResolution.decision, "AUTO_LINK");
if (singleResolution.decision === "AUTO_LINK") {
  assert.equal(singleResolution.masterIndex, 0);
}

console.log("MATCHER master resolution verification: PASS");

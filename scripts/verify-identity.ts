import { strict as assert } from "node:assert";
import { matchProductIdentity } from "../lib/matcher/identity.ts";

const base = {
  identifiers: [
    { type: "JAN" as const, value: "4901234567890" },
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
  { ...base, identifiers: [{ type: "JAN", value: "4901-2345-67890" }, { type: "MPN", value: "ABC-123" }] },
  base,
);
assert.equal(strong.decision, "AUTO_LINK");
assert.equal(strong.matchMethod, "STRONG");

const variantBlock = matchProductIdentity({ ...base, color: "White" }, base);
assert.equal(variantBlock.decision, "BLOCK");
assert.ok(variantBlock.hardBlockReasons.includes("COLOR_MISMATCH"));

const mpnBlock = matchProductIdentity(
  { ...base, identifiers: [{ type: "JAN", value: "4901234567890" }, { type: "MPN", value: "ABC-999" }] },
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
  { ...base, identifiers: [{ type: "JAN", value: "4901234567890" }, { type: "JAN", value: "4909999999999" }, { type: "MPN", value: "ABC-123" }] },
  base,
);
assert.equal(duplicateIdentifierBlock.decision, "BLOCK");
assert.ok(duplicateIdentifierBlock.hardBlockReasons.includes("JAN_CONFLICT"));

const deterministicA = matchProductIdentity({ ...base }, base);
const deterministicB = matchProductIdentity({ ...base }, base);
assert.deepEqual(deterministicA, deterministicB);


const normalizedVariantEvidence = matchProductIdentity(
  { ...base, color: "Dark   Blue" },
  { ...base, color: "Dark Blue" },
);
const colorEvidence = normalizedVariantEvidence.evidence.find((item) => item.field === "color");
assert.equal(colorEvidence?.result, "MATCH");

const identifierFormattingEvidence = matchProductIdentity(
  { ...base, identifiers: [{ type: "JAN", value: "4901-2345-67890" }, { type: "MPN", value: "ABC-123" }] },
  base,
);
const janEvidence = identifierFormattingEvidence.evidence.find((item) => item.field === "JAN");
assert.equal(janEvidence?.result, "MATCH");

console.log("MATCHER identity verification: PASS");

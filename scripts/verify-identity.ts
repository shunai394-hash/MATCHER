import { strict as assert } from "node:assert";
import { evaluateIdentityMatch } from "../lib/matcher/identity.ts";

const base = {
  gtin: "4901234567890",
  mpn: "ABC-123",
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

const strong = evaluateIdentityMatch(
  { ...base, gtin: "4901-2345-67890" },
  base,
);
assert.equal(strong.decision, "AUTO_LINK");
assert.equal(strong.matchMethod, "STRONG");

const variantBlock = evaluateIdentityMatch(
  { ...base, color: "White" },
  base,
);
assert.equal(variantBlock.decision, "BLOCK");
assert.ok(variantBlock.blockingReasons.includes("COLOR_MISMATCH"));

const mpnBlock = evaluateIdentityMatch(
  { ...base, mpn: "ABC-999", modelNumber: "ABC-999" },
  base,
);
assert.equal(mpnBlock.decision, "BLOCK");
assert.ok(mpnBlock.blockingReasons.includes("MPN_MISMATCH"));

const weakNeverPromotes = evaluateIdentityMatch(
  { title: "Example product 128GB Black", brand: "Example" },
  { title: "Example product", brand: "Example" },
);
assert.equal(weakNeverPromotes.decision, "REVIEW");
assert.equal(weakNeverPromotes.matchMethod, "WEAK");

const deterministicA = evaluateIdentityMatch({ ...base }, base);
const deterministicB = evaluateIdentityMatch({ ...base }, base);
assert.deepEqual(deterministicA, deterministicB);

console.log("MATCHER identity verification: PASS");

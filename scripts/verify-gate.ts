import { strict as assert } from "node:assert";
import { calculateExpectedProfit, evaluateSellability } from "../lib/matcher/gate.ts";
import { matchProductIdentity } from "../lib/matcher/identity.ts";

const incomplete = calculateExpectedProfit({
  salePrice: 10000,
  supplierCost: 4000,
  shippingCost: null,
  paymentFee: 300,
  marketplaceFee: 500,
  tax: 500,
  otherCost: 100,
});
assert.equal(incomplete.complete, false);
assert.equal(incomplete.expectedProfit, null);
assert.deepEqual(incomplete.missing, ["shippingCost"]);

const blocked = evaluateSellability({
  identityDecision: "AUTO_LINK",
  hardBlockReasons: ["MODEL_MISMATCH"],
  orderability: "ORDERABLE",
  inventoryKnown: true,
  inventoryFresh: true,
  priceKnown: true,
  priceFresh: true,
  supplierCost: 4000,
  shippingCost: 500,
  requiredFeesKnown: true,
  expectedProfit: 3000,
  profitCurrency: "JPY",
});
assert.equal(blocked.status, "BLOCKED");
assert.ok(blocked.reasons.includes("MODEL_MISMATCH"));

const sellable = evaluateSellability({
  identityDecision: "AUTO_LINK",
  hardBlockReasons: [],
  orderability: "ORDERABLE",
  inventoryKnown: true,
  inventoryFresh: true,
  priceKnown: true,
  priceFresh: true,
  supplierCost: 4000,
  shippingCost: 500,
  requiredFeesKnown: true,
  expectedProfit: 3000,
  profitCurrency: "JPY",
});
assert.equal(sellable.status, "SELLABLE");

console.log("MATCHER gate verification: PASS");


const exactIdentifier = matchProductIdentity(
  { brand: "Acme", identifiers: [{ type: "JAN", value: "4901234567890" }] },
  { brand: "Acme", identifiers: [{ type: "JAN", value: "4901234567890" }] },
);
assert.equal(exactIdentifier.decision, "AUTO_LINK");
assert.equal(exactIdentifier.confidence, 1);

const mpnMatch = matchProductIdentity(
  { brand: "Acme", identifiers: [{ type: "MPN", value: "AB-123" }] },
  { brand: "acme", identifiers: [{ type: "MPN", value: "AB123" }] },
);
assert.equal(mpnMatch.decision, "AUTO_LINK");
assert.equal(mpnMatch.confidence, 0.98);

const variantBlocked = matchProductIdentity(
  {
    brand: "Acme",
    identifiers: [{ type: "JAN", value: "4901234567890" }],
    color: "Black",
  },
  {
    brand: "Acme",
    identifiers: [{ type: "JAN", value: "4901234567890" }],
    color: "White",
  },
);
assert.equal(variantBlocked.decision, "BLOCK");
assert.ok(variantBlocked.hardBlockReasons.includes("COLOR_MISMATCH"));

const insufficientEvidence = matchProductIdentity(
  { brand: "Acme", modelNumber: "X-1" },
  { brand: "Other", modelNumber: "X-2" },
);
assert.equal(insufficientEvidence.decision, "REVIEW");

console.log("MATCHER identity verification: PASS");

import { strict as assert } from "node:assert";
import { calculateExpectedProfit, evaluateSellability } from "../lib/matcher/gate.ts";
import { matchIdentity } from "../lib/matcher/identity.ts";

const exact = matchIdentity(
  { id: "supplier-1", brand: "ACME", modelNumber: "AX-204", identifiers: [{ type: "JAN", value: "4901234567894" }], variant: { color: "BLACK", capacity: "256GB" } },
  [{ id: "master-1", brand: "ACME", modelNumber: "AX-204", identifiers: [{ type: "JAN", value: "4901234567894" }], variant: { color: "BLACK", capacity: "256GB" } }],
);
assert.equal(exact.decision, "AUTO_LINK");
assert.equal(exact.masterProductId, "master-1");
assert.equal(exact.confidence, 1);

const variantConflict = matchIdentity(
  { id: "supplier-2", brand: "ACME", modelNumber: "AX-204", variant: { color: "BLACK", capacity: "256GB" } },
  [{ id: "master-2", brand: "ACME", modelNumber: "AX-204", variant: { color: "WHITE", capacity: "128GB" } }],
);
assert.equal(variantConflict.decision, "BLOCK");
assert.ok(variantConflict.reasons.includes("VARIANT_CONFLICT"));

const insufficient = matchIdentity(
  { id: "supplier-3", brand: "ACME" },
  [{ id: "master-3", brand: "ACME", modelNumber: "AX-204" }],
);
assert.equal(insufficient.decision, "REVIEW");
assert.equal(insufficient.masterProductId, null);

const ambiguous = matchIdentity(
  { id: "supplier-4", brand: "ACME", modelNumber: "AX-204" },
  [
    { id: "master-4a", brand: "ACME", modelNumber: "AX-204" },
    { id: "master-4b", brand: "ACME", modelNumber: "AX-204" },
  ],
);
assert.equal(ambiguous.decision, "REVIEW");
assert.ok(ambiguous.reasons.includes("AMBIGUOUS_CANDIDATES"));

const invalidGtin = matchIdentity(
  { id: "supplier-5", identifiers: [{ type: "JAN", value: "4901234567890" }] },
  [{ id: "master-5", identifiers: [{ type: "JAN", value: "4901234567894" }] }],
);
assert.equal(invalidGtin.decision, "REVIEW");
assert.ok(invalidGtin.reasons.includes("INVALID_GTIN"));


const contradictoryIdentity = matchIdentity(
  { id: "supplier-6", brand: "ACME", modelNumber: "AX-204", identifiers: [{ type: "JAN", value: "4901234567894" }] },
  [{ id: "master-6", brand: "OTHER", modelNumber: "ZZ-999", identifiers: [{ type: "JAN", value: "4901234567894" }] }],
);
assert.equal(contradictoryIdentity.decision, "BLOCK");
assert.ok(contradictoryIdentity.reasons.includes("IDENTITY_ATTRIBUTE_CONFLICT"));


const compatibleBeatsConflict = matchIdentity(
  { id: "supplier-7", brand: "ACME", modelNumber: "AX-204", identifiers: [{ type: "JAN", value: "4901234567894" }], variant: { color: "BLACK" } },
  [
    { id: "master-7-bad", brand: "ACME", modelNumber: "AX-204", identifiers: [{ type: "JAN", value: "4901234567894" }], variant: { color: "WHITE" } },
    { id: "master-7-good", brand: "ACME", modelNumber: "AX-204", identifiers: [{ type: "JAN", value: "4901234567894" }], variant: { color: "BLACK" } },
  ],
);
assert.equal(compatibleBeatsConflict.decision, "AUTO_LINK");
assert.equal(compatibleBeatsConflict.masterProductId, "master-7-good");

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
  inventoryAvailable: true,
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
  inventoryAvailable: true,
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

const outOfStock = evaluateSellability({
  identityDecision: "AUTO_LINK",
  hardBlockReasons: [],
  orderability: "ORDERABLE",
  inventoryKnown: true,
  inventoryAvailable: false,
  inventoryFresh: true,
  priceKnown: true,
  priceFresh: true,
  supplierCost: 4000,
  shippingCost: 500,
  requiredFeesKnown: true,
  expectedProfit: 3000,
  profitCurrency: "JPY",
});
assert.equal(outOfStock.status, "BLOCKED");
assert.ok(outOfStock.reasons.includes("OUT_OF_STOCK"));

console.log("MATCHER gate verification: PASS");

// JAN on one side and EAN/UPC on the other are the same GTIN.
const crossLabel = matchIdentity(
  { id: "supplier-8", identifiers: [{ type: "EAN", value: "4901234567894" }] },
  [{ id: "master-8", identifiers: [{ type: "JAN", value: "4901234567894" }] }],
);
assert.equal(crossLabel.decision, "AUTO_LINK");
const upcVsEan = matchIdentity(
  { id: "supplier-9", identifiers: [{ type: "UPC", value: "012345678905" }] },
  [{ id: "master-9", identifiers: [{ type: "EAN", value: "0012345678905" }] }],
);
assert.equal(upcVsEan.decision, "AUTO_LINK");

// inventory 0 and inventory unknown are never SELLABLE.
for (const [inventoryKnown, inventoryAvailable, reason] of [[true, false, "OUT_OF_STOCK"], [false, false, "INVENTORY_UNKNOWN"]] as const) {
  const r = evaluateSellability({
    identityDecision: "AUTO_LINK", hardBlockReasons: [], orderability: "ORDERABLE",
    inventoryKnown, inventoryAvailable, inventoryFresh: true, priceKnown: true, priceFresh: true,
    supplierCost: 4000, shippingCost: 500, requiredFeesKnown: true, expectedProfit: 3000, profitCurrency: "JPY",
  });
  assert.equal(r.status, "BLOCKED");
  assert.ok(r.reasons.includes(reason));
}
console.log("MATCHER gate verification (GTIN cross-label, inventory 0/null): PASS");

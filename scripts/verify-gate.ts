import { strict as assert } from "node:assert";
import { calculateExpectedProfit, evaluateSellability } from "../lib/matcher/gate";

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

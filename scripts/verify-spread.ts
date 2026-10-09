import { rankPriceSpreads, calculateNetEconomics } from "../lib/matcher/ingestion/spread.ts";

const products = [
  { sourceKey: "yahoo-shopping", externalId: "a", productName: "A", identifiers: [{ type: "JAN" as const, value: "4901234567894" }], cost: 1000, currency: "JPY" },
  { sourceKey: "rakuten-ichiba", externalId: "b", productName: "B", identifiers: [{ type: "JAN" as const, value: "4901234567894" }], cost: 1600, currency: "JPY" },
  { sourceKey: "rakuten-ichiba", externalId: "c", productName: "C", identifiers: [{ type: "JAN" as const, value: "4901234567887" }], cost: 999, currency: "JPY" },
];

const result = rankPriceSpreads(products);
if (result.length !== 1) throw new Error("expected exactly one cross-source spread");
if (result[0].buy.cost !== 1000 || result[0].referenceSell.cost !== 1600) throw new Error("wrong buy/sell ordering");
if (result[0].grossSpread !== 600) throw new Error("wrong gross spread");
if (result[0].grossRoiPercent !== 60) throw new Error("wrong gross ROI");

const sameSourceOnly = rankPriceSpreads([
  { ...products[0], externalId: "same-low", cost: 1000 },
  { ...products[0], externalId: "same-high", cost: 1800 },
]);
if (sameSourceOnly.length !== 0) throw new Error("same-source prices must not be presented as cross-source opportunity");
const invalidJanOnly = rankPriceSpreads([
  { ...products[0], identifiers: [{ type: "JAN" as const, value: "490000000001" }], externalId: "invalid-low", cost: 1000 },
  { ...products[1], identifiers: [{ type: "JAN" as const, value: "490000000001" }], externalId: "invalid-high", cost: 1800 },
]);
if (invalidJanOnly.length !== 0) throw new Error("invalid JAN must not produce a price spread");

console.log("verify:spread cross-source guard PASS");

const economics = calculateNetEconomics({ salePrice: 2000, buyPrice: 1000, shippingCost: 200, marketplaceFeeRate: 0.1, paymentFeeRate: 0.03, fixedFee: 0 });
if (!economics.valid || economics.expectedProfit !== 540) throw new Error("net economics calculation failed");
const invalid = calculateNetEconomics({ salePrice: 0, buyPrice: 1000, shippingCost: 0, marketplaceFeeRate: 0.1, paymentFeeRate: 0.03, fixedFee: 0 });
if (invalid.valid) throw new Error("invalid economics accepted");
console.log("verify:net-economics PASS");

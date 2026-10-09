import { rankPriceSpreads, calculateNetEconomics } from "../lib/matcher/ingestion/spread.ts";

const products = [
  { externalId: "a", sourceKey: "source-a", productName: "Product A Black", identifiers: [{ type: "JAN" as const, value: "4901234567894" }], color: "Black", cost: 1000, currency: "JPY" },
  { externalId: "b", sourceKey: "source-b", productName: "Product A Black", identifiers: [{ type: "JAN" as const, value: "4901234567894" }], color: "Black", cost: 1600, currency: "JPY" },
  { externalId: "c", sourceKey: "source-c", productName: "Product C", identifiers: [{ type: "JAN" as const, value: "4901234567889" }], cost: 999, currency: "JPY" },
];

const result = rankPriceSpreads(products);
if (result.length !== 1) throw new Error("expected exactly one strong-identity cross-source spread");
if (result[0].buy.cost !== 1000 || result[0].referenceSell.cost !== 1600) throw new Error("wrong buy/sell ordering");
if (result[0].grossSpread !== 600) throw new Error("wrong gross spread");
if (result[0].grossRoiPercent !== 60) throw new Error("wrong gross ROI");

const variantConflict = rankPriceSpreads([
  { ...products[0], color: "Black" },
  { ...products[1], color: "White" },
]);
if (variantConflict.length !== 0) throw new Error("variant-conflicting JAN group must be quarantined");

const mpnConflict = rankPriceSpreads([
  { ...products[0], identifiers: [{ type: "JAN" as const, value: "4901234567894" }, { type: "MPN" as const, value: "MODEL-A" }] },
  { ...products[1], identifiers: [{ type: "JAN" as const, value: "4901234567894" }, { type: "MPN" as const, value: "MODEL-B" }] },
]);
if (mpnConflict.length !== 0) throw new Error("MPN-conflicting JAN group must be quarantined");

const invalidJan = rankPriceSpreads([
  { ...products[0], identifiers: [{ type: "JAN" as const, value: "490000000001" }] },
  { ...products[1], identifiers: [{ type: "JAN" as const, value: "490000000001" }] },
]);
if (invalidJan.length !== 0) throw new Error("invalid check-digit JAN must not produce a spread");

console.log("verify:spread strong identity + variant + MPN + check-digit PASS");

const economics = calculateNetEconomics({ salePrice: 2000, buyPrice: 1000, shippingCost: 200, marketplaceFeeRate: 0.1, paymentFeeRate: 0.03, fixedFee: 0 });
if (!economics.valid || economics.expectedProfit !== 740) throw new Error("net economics calculation failed");
const invalid = calculateNetEconomics({ salePrice: 0, buyPrice: 1000, shippingCost: 0, marketplaceFeeRate: 0.1, paymentFeeRate: 0.03, fixedFee: 0 });
if (invalid.valid) throw new Error("invalid economics accepted");
console.log("verify:net-economics PASS");

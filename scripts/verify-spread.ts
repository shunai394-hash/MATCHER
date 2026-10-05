import { rankPriceSpreads } from "../lib/matcher/ingestion/spread";

const products = [
  { externalId: "a", productName: "A", identifiers: [{ type: "JAN" as const, value: "490000000001" }], cost: 1000, currency: "JPY" },
  { externalId: "b", productName: "B", identifiers: [{ type: "JAN" as const, value: "490000000001" }], cost: 1600, currency: "JPY" },
  { externalId: "c", productName: "C", identifiers: [{ type: "JAN" as const, value: "490000000002" }], cost: 999, currency: "JPY" },
];

const result = rankPriceSpreads(products);
if (result.length !== 1) throw new Error("expected exactly one cross-source spread");
if (result[0].buy.cost !== 1000 || result[0].referenceSell.cost !== 1600) throw new Error("wrong buy/sell ordering");
if (result[0].grossSpread !== 600) throw new Error("wrong gross spread");
if (result[0].grossRoiPercent !== 60) throw new Error("wrong gross ROI");

console.log("verify:spread PASS");

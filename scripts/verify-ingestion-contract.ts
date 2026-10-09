import { normalizeSourceProduct } from "../lib/matcher/ingestion/normalize.ts";
import { validateSourceProduct } from "../lib/matcher/ingestion/validate.ts";

const item = normalizeSourceProduct({
  sourceKey: "yahoo-shopping",
  externalId: "  x-1 ",
  productName: "  Test Product ",
  identifiers: [{ type: "JAN", value: "4900-0000 0001" }, { type: "JAN", value: "490000000001" }],
  cost: 1000,
  currency: "jpy",
});
if (item.externalId !== "x-1" || item.productName !== "Test Product") throw new Error("normalization failed");
if (item.identifiers?.length !== 1 || item.identifiers[0].value !== "490000000001") throw new Error("identifier normalization failed");
if (item.sourceKey !== "yahoo-shopping") throw new Error("source identity missing");
if (validateSourceProduct(item).length) throw new Error("valid item rejected");
console.log("verify:ingestion-contract PASS");

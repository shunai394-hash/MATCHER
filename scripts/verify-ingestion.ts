import { normalizeSourceProduct } from "../lib/matcher/ingestion/normalize";
import { validateSourceProduct } from "../lib/matcher/ingestion/validate";

const valid = normalizeSourceProduct({
  externalId: "  sku-1 ",
  productName: "  Example Product ",
  currency: "jpy",
  identifiers: [{ type: "JAN", value: "4901234567890" }, { type: "JAN", value: "4901234567890" }],
  cost: 1000,
  shippingCost: 300,
  inventory: 4,
});
const errors = validateSourceProduct(valid);
if (errors.length) throw new Error(errors.join(","));
if (valid.externalId !== "sku-1" || valid.productName !== "Example Product" || valid.identifiers?.length !== 1) {
  throw new Error("NORMALIZATION_REGRESSION");
}

const invalid = validateSourceProduct({ ...valid, inventory: -1 });
if (!invalid.includes("INVENTORY_INVALID")) throw new Error("VALIDATION_REGRESSION");
console.log("PASS ingestion normalization + validation");
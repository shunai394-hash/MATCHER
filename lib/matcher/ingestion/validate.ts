import type { SourceProduct } from "./types";

export function validateSourceProduct(item: SourceProduct): string[] {
  const errors: string[] = [];
  if (!item.externalId) errors.push("EXTERNAL_ID_REQUIRED");
  if (!item.productName) errors.push("PRODUCT_NAME_REQUIRED");
  if (!/^[A-Z]{3}$/.test(item.currency ?? "")) errors.push("CURRENCY_INVALID");
  for (const id of item.identifiers ?? []) {
    if (!["JAN","EAN","UPC","MPN","SKU"].includes(id.type)) errors.push("IDENTIFIER_TYPE_INVALID");
    if (!id.value) errors.push("IDENTIFIER_VALUE_REQUIRED");
  }
  if (item.cost != null && (!Number.isFinite(item.cost) || item.cost < 0)) errors.push("COST_INVALID");
  if (item.shippingCost != null && (!Number.isFinite(item.shippingCost) || item.shippingCost < 0)) errors.push("SHIPPING_INVALID");
  if (item.inventory != null && (!Number.isInteger(item.inventory) || item.inventory < 0)) errors.push("INVENTORY_INVALID");
  return [...new Set(errors)];
}
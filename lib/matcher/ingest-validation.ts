/**
 * Ingest payload types + validation (pure, no I/O). Everything is validated before any write.
 */

export const ORDERABILITY = ["ORDERABLE", "OUT_OF_STOCK", "UNKNOWN", "BLOCKED"] as const;
export const IDENTIFIER_TYPES = ["JAN", "EAN", "UPC", "MPN", "SKU", "SUPPLIER_PRODUCT_NO"] as const;

export type SupplierItem = {
  supplierKey: string;
  supplierName: string;
  supplierProductId: string;
  supplierSku?: string;
  /** Preferred. `title` is accepted as a legacy alias and stored in supplier_product.product_name. */
  productName?: string;
  title?: string;
  brand?: string;
  manufacturer?: string;
  modelNumber?: string;
  color?: string;
  size?: string;
  capacity?: string;
  generation?: string;
  setCount?: number;
  condition?: string;
  sourceUrl?: string;
  /** Supplier unit cost. Stored in supplier_offer_snapshot.supplier_cost. */
  cost?: number;
  shippingCost?: number;
  /** 0..1. Defaults to 1 when shippingCost is provided (the supplier quoted it), else 0. */
  shippingConfidence?: number;
  inventory?: number;
  orderability?: (typeof ORDERABILITY)[number];
  currency?: string;
  /** ISO timestamp of the observation at the supplier; defaults to now. */
  observedAt?: string;
  identifiers?: Array<{ type: (typeof IDENTIFIER_TYPES)[number]; value: string }>;
};

export type MarketObservation = {
  masterProductId: string;
  productVariantId?: string;
  source: string;
  sourceProductId?: string;
  salePrice: number;
  paymentFee?: number;
  marketplaceFee?: number;
  tax?: number;
  otherCost?: number;
  sold?: boolean;
  sourceUrl?: string;
  observedAt?: string;
};

const isText = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptText = (v: unknown) => v === undefined || v === null || typeof v === "string";
const isOptNonNeg = (v: unknown) => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const isOptTimestamp = (v: unknown) => v === undefined || v === null || (typeof v === "string" && Number.isFinite(new Date(v).getTime()));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateSupplierItem(item: SupplierItem, index: number): string[] {
  const p = `supplierItems[${index}]`;
  const errors: string[] = [];
  if (!item || typeof item !== "object") return [`${p}: must be an object`];
  if (!isText(item.supplierKey)) errors.push(`${p}.supplierKey is required`);
  if (!isText(item.supplierName)) errors.push(`${p}.supplierName is required`);
  if (!isText(item.supplierProductId)) errors.push(`${p}.supplierProductId is required`);
  for (const key of ["supplierSku", "productName", "title", "brand", "manufacturer", "modelNumber", "color", "size", "capacity", "generation", "condition", "sourceUrl"] as const) {
    if (!isOptText(item[key])) errors.push(`${p}.${key} must be a string`);
  }
  for (const key of ["cost", "shippingCost", "inventory"] as const) {
    if (!isOptNonNeg(item[key])) errors.push(`${p}.${key} must be a non-negative number`);
  }
  if (item.inventory != null && !Number.isInteger(item.inventory)) errors.push(`${p}.inventory must be an integer`);
  if (item.setCount != null && !(Number.isInteger(item.setCount) && item.setCount > 0)) errors.push(`${p}.setCount must be a positive integer`);
  if (item.shippingConfidence != null && !(typeof item.shippingConfidence === "number" && item.shippingConfidence >= 0 && item.shippingConfidence <= 1)) {
    errors.push(`${p}.shippingConfidence must be between 0 and 1`);
  }
  if (item.orderability != null && !ORDERABILITY.includes(item.orderability)) errors.push(`${p}.orderability must be one of ${ORDERABILITY.join(",")}`);
  if (item.currency != null && !/^[A-Za-z]{3}$/.test(item.currency)) errors.push(`${p}.currency must be a 3-letter code`);
  if (!isOptTimestamp(item.observedAt)) errors.push(`${p}.observedAt must be an ISO timestamp`);
  if (item.identifiers != null && !Array.isArray(item.identifiers)) return [...errors, `${p}.identifiers must be an array`];
  for (const [i, identifier] of (item.identifiers ?? []).entries()) {
    if (!identifier || !IDENTIFIER_TYPES.includes(identifier.type) || !isText(identifier.value)) {
      errors.push(`${p}.identifiers[${i}] must have type (${IDENTIFIER_TYPES.join(",")}) and value`);
    }
  }
  return errors;
}

export function validateMarketObservation(obs: MarketObservation, index: number): string[] {
  const p = `marketObservations[${index}]`;
  const errors: string[] = [];
  if (!obs || typeof obs !== "object") return [`${p}: must be an object`];
  if (!isText(obs.masterProductId) || !UUID.test(obs.masterProductId)) errors.push(`${p}.masterProductId must be a UUID`);
  if (obs.productVariantId != null && !(isText(obs.productVariantId) && UUID.test(obs.productVariantId))) errors.push(`${p}.productVariantId must be a UUID`);
  if (!isText(obs.source)) errors.push(`${p}.source is required`);
  if (!(typeof obs.salePrice === "number" && Number.isFinite(obs.salePrice) && obs.salePrice >= 0)) errors.push(`${p}.salePrice must be a non-negative number`);
  for (const key of ["paymentFee", "marketplaceFee", "tax", "otherCost"] as const) {
    if (!isOptNonNeg(obs[key])) errors.push(`${p}.${key} must be a non-negative number`);
  }
  if (obs.sold != null && typeof obs.sold !== "boolean") errors.push(`${p}.sold must be a boolean`);
  if (!isOptText(obs.sourceProductId) || !isOptText(obs.sourceUrl)) errors.push(`${p}.sourceProductId/sourceUrl must be strings`);
  if (!isOptTimestamp(obs.observedAt)) errors.push(`${p}.observedAt must be an ISO timestamp`);
  return errors;
}

export function validateBatch(supplierItems: SupplierItem[], marketObservations: MarketObservation[]) {
  return [...supplierItems.flatMap(validateSupplierItem), ...marketObservations.flatMap(validateMarketObservation)];
}

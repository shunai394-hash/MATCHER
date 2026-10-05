export type SourceProduct = {
  externalId: string;
  productName: string;
  brand?: string | null;
  manufacturer?: string | null;
  modelNumber?: string | null;
  identifiers?: Array<{ type: "JAN" | "EAN" | "UPC" | "MPN" | "SKU"; value: string }>;
  color?: string | null;
  size?: string | null;
  capacity?: string | null;
  generation?: string | null;
  setCount?: number | null;
  condition?: string | null;
  cost?: number | null;
  shippingCost?: number | null;
  inventory?: number | null;
  orderability?: "ORDERABLE" | "OUT_OF_STOCK" | "UNKNOWN" | "BLOCKED";
  currency?: string;
  sourceUrl?: string | null;
  observedAt?: string;
};

export type SourceAdapter = {
  readonly key: string;
  discover(signal?: AbortSignal): Promise<SourceProduct[]>;
};
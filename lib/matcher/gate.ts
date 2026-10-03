export type IdentityDecision = "AUTO_LINK" | "REVIEW" | "BLOCK" | "REJECT";
export type Orderability = "ORDERABLE" | "OUT_OF_STOCK" | "UNKNOWN" | "BLOCKED";

export type SellabilityInput = {
  identityDecision: IdentityDecision;
  hardBlockReasons: string[];
  orderability: Orderability;
  inventoryKnown: boolean;
  inventoryFresh: boolean;
  priceKnown: boolean;
  priceFresh: boolean;
  supplierCost: number | null;
  shippingCost: number | null;
  requiredFeesKnown: boolean;
  expectedProfit: number | null;
  profitCurrency: string | null;
};

export type SellabilityResult = {
  status: "SELLABLE" | "BLOCKED";
  reasons: string[];
};

export function evaluateSellability(input: SellabilityInput): SellabilityResult {
  const reasons = [...new Set(input.hardBlockReasons.filter(Boolean))];

  if (input.identityDecision !== "AUTO_LINK") reasons.push("IDENTITY_NOT_AUTO_LINKED");
  if (input.orderability !== "ORDERABLE") reasons.push("SUPPLIER_NOT_ORDERABLE");
  if (!input.inventoryKnown) reasons.push("INVENTORY_UNKNOWN");
  if (!input.inventoryFresh) reasons.push("INVENTORY_STALE");
  if (!input.priceKnown) reasons.push("PRICE_UNKNOWN");
  if (!input.priceFresh) reasons.push("PRICE_STALE");
  if (input.supplierCost === null) reasons.push("SUPPLIER_COST_UNKNOWN");
  if (input.shippingCost === null) reasons.push("SHIPPING_COST_UNKNOWN");
  if (!input.requiredFeesKnown) reasons.push("REQUIRED_FEES_UNKNOWN");
  if (input.expectedProfit === null || input.profitCurrency === null) reasons.push("PROFIT_NOT_CALCULABLE");\n  else if (!Number.isFinite(input.expectedProfit) || input.expectedProfit <= 0) reasons.push("PROFIT_NOT_POSITIVE");

  return {
    status: reasons.length === 0 ? "SELLABLE" : "BLOCKED",
    reasons,
  };
}

export type ProfitInput = {
  salePrice: number;
  supplierCost: number | null;
  shippingCost: number | null;
  paymentFee: number | null;
  marketplaceFee: number | null;
  tax: number | null;
  otherCost: number | null;
};

export function calculateExpectedProfit(input: ProfitInput) {
  const required = [
    ["supplierCost", input.supplierCost],
    ["shippingCost", input.shippingCost],
    ["paymentFee", input.paymentFee],
    ["marketplaceFee", input.marketplaceFee],
    ["tax", input.tax],
    ["otherCost", input.otherCost],
  ] as const;

  const missing = required.filter(([, value]) => value === null).map(([name]) => name);
  if (missing.length > 0) {
    return { expectedProfit: null, complete: false, missing };
  }

  const expectedProfit =
    input.salePrice -
    input.supplierCost! -
    input.shippingCost! -
    input.paymentFee! -
    input.marketplaceFee! -
    input.tax! -
    input.otherCost!;

  return { expectedProfit, complete: true, missing: [] as string[] };
}

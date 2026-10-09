import { matchProductIdentity, normalizeIdentifier, type IdentityCandidate } from "../identity";
import type { SourceProduct } from "./types";

export type PriceSpread = {
  buy: SourceProduct;
  referenceSell: SourceProduct;
  grossSpread: number;
  grossRoiPercent: number;
};

function identityCandidate(product: SourceProduct): IdentityCandidate {
  return {
    brand: product.brand,
    modelNumber: product.modelNumber,
    title: product.productName,
    identifiers: (product.identifiers ?? []).map(({ type, value }) => ({ type, value })),
    color: product.color,
    size: product.size,
    capacity: product.capacity,
    generation: product.generation,
    setCount: product.setCount,
    condition: product.condition,
  };
}

export function rankPriceSpreads(products: SourceProduct[]): PriceSpread[] {
  const byJan = new Map<string, SourceProduct[]>();
  for (const product of products) {
    const jan = normalizeIdentifier(product.identifiers?.find((x) => x.type === "JAN")?.value);
    if (!jan || product.cost == null || product.cost <= 0) continue;
    const list = byJan.get(jan) ?? [];
    list.push(product);
    byJan.set(jan, list);
  }

  const results: PriceSpread[] = [];
  for (const list of byJan.values()) {
    if (list.length < 2) continue;
    const ordered = [...list].sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity));
    const buy = ordered[0];
    if (buy.cost == null) continue;

    for (const referenceSell of ordered.slice(1).reverse()) {
      if (referenceSell.cost == null || referenceSell.cost <= buy.cost) continue;
      if (buy.sourceKey === referenceSell.sourceKey && buy.externalId === referenceSell.externalId) continue;

      // A matching JAN is necessary but not sufficient: conflicting MPN or variant
      // evidence must block a spread so different products never look profitable.
      const identity = matchProductIdentity(identityCandidate(buy), identityCandidate(referenceSell));
      if (identity.decision !== "AUTO_LINK" || identity.matchMethod !== "STRONG") continue;

      const grossSpread = referenceSell.cost - buy.cost;
      results.push({
        buy,
        referenceSell,
        grossSpread,
        grossRoiPercent: (grossSpread / buy.cost) * 100,
      });
      break;
    }
  }
  return results.sort((a, b) => b.grossSpread - a.grossSpread);
}

export type NetEconomics = { valid: boolean; expectedProfit: number; roiPercent: number; totalCost: number };

export function calculateNetEconomics(input: { salePrice: number; buyPrice: number; shippingCost: number; marketplaceFeeRate: number; paymentFeeRate: number; fixedFee: number }): NetEconomics {
  const { salePrice, buyPrice, shippingCost, marketplaceFeeRate, paymentFeeRate, fixedFee } = input;
  if (![salePrice,buyPrice,shippingCost,marketplaceFeeRate,paymentFeeRate,fixedFee].every(Number.isFinite) || salePrice <= 0 || buyPrice <= 0 || shippingCost < 0 || marketplaceFeeRate < 0 || paymentFeeRate < 0 || fixedFee < 0) return { valid: false, expectedProfit: 0, roiPercent: 0, totalCost: 0 };
  const fees = salePrice * (marketplaceFeeRate + paymentFeeRate) + fixedFee;
  const totalCost = buyPrice + shippingCost + fees;
  const expectedProfit = salePrice - totalCost;
  return { valid: true, expectedProfit, roiPercent: (expectedProfit / (buyPrice + shippingCost)) * 100, totalCost };
}

export function isProfitableEconomics(result: NetEconomics, minimumProfit = 1, minimumRoiPercent = 0) {
  return result.valid && Number.isFinite(result.expectedProfit) && Number.isFinite(result.roiPercent) && result.expectedProfit >= minimumProfit && result.roiPercent >= minimumRoiPercent;
}

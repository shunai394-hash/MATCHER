import type { SourceProduct } from "./types";
import { isValidGlobalIdentifier } from "../identity.ts";

export type PriceSpread = {
  buy: SourceProduct;
  referenceSell: SourceProduct;
  grossSpread: number;
  grossRoiPercent: number;
};

export function rankPriceSpreads(products: SourceProduct[]): PriceSpread[] {
  const byJan = new Map<string, SourceProduct[]>();
  for (const product of products) {
    const jan = product.identifiers?.find((x) => x.type === "JAN")?.value;
    if (!jan || !isValidGlobalIdentifier(jan, "JAN") || product.cost == null || product.cost <= 0) continue;
    const list = byJan.get(jan) ?? [];
    list.push(product);
    byJan.set(jan, list);
  }
  const results: PriceSpread[] = [];
  for (const list of byJan.values()) {
    if (list.length < 2) continue;
    const buy = [...list].sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity))[0];
    const referenceSell = [...list].sort((a, b) => (b.cost ?? -Infinity) - (a.cost ?? -Infinity))[0];
    if (buy === referenceSell || referenceSell.cost == null || buy.cost == null) continue;
    if (!buy.sourceKey || !referenceSell.sourceKey || buy.sourceKey === referenceSell.sourceKey) continue;
    const grossSpread = referenceSell.cost - buy.cost;
    if (grossSpread <= 0) continue;
    results.push({ buy, referenceSell, grossSpread, grossRoiPercent: (grossSpread / buy.cost) * 100 });
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

import type { SourceProduct } from "./types";

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
    if (!jan || product.cost == null || product.cost <= 0) continue;
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
    const grossSpread = referenceSell.cost - buy.cost;
    if (grossSpread <= 0) continue;
    results.push({ buy, referenceSell, grossSpread, grossRoiPercent: (grossSpread / buy.cost) * 100 });
  }
  return results.sort((a, b) => b.grossSpread - a.grossSpread);
}

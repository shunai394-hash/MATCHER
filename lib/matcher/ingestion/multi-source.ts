import { searchYahooShopping } from "./yahoo-shopping";
import { searchRakutenIchiba } from "./rakuten-ichiba";
import type { SourceProduct } from "./types";

export type ShoppingSource = "yahoo" | "rakuten";

export async function discoverShopping(query: string, sources: ShoppingSource[] = ["yahoo", "rakuten"], signal?: AbortSignal) {
  const results = await Promise.allSettled(sources.map((source) => source === "yahoo" ? searchYahooShopping(query, signal) : searchRakutenIchiba(query, signal)));
  const products: SourceProduct[] = [];
  const errors: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") products.push(...result.value);
    else errors.push(`${sources[index]}:${result.reason instanceof Error ? result.reason.message : "UNKNOWN"}`);
  });
  return { products, errors };
}

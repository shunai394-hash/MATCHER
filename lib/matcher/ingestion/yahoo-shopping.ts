import type { SourceProduct } from "./types";

type YahooHit = {
  Code?: string;
  Name?: string;
  JanCode?: string;
  Price?: number;
  Url?: string;
  Seller?: { SellerId?: string; Name?: string; Url?: string };
  Brand?: { Id?: number; Name?: string };
  Condition?: string;
};

type YahooResponse = { hits?: YahooHit[] };

export async function searchYahooShopping(query: string, signal?: AbortSignal): Promise<SourceProduct[]> {
  const appId = process.env.MATCHER_YAHOO_SHOPPING_APP_ID?.trim();
  if (!appId) throw new Error("YAHOO_SHOPPING_APP_ID_NOT_CONFIGURED");
  const url = new URL("https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch");
  url.searchParams.set("appid", appId);
  url.searchParams.set("query", query);
  url.searchParams.set("sort", "+price");
  url.searchParams.set("condition", "new");
  url.searchParams.set("results", "50");
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`YAHOO_SHOPPING_HTTP_${response.status}`);
  const body = (await response.json()) as YahooResponse;
  return (body.hits ?? []).flatMap((hit) => {
    const price = Number(hit.Price);
    const jan = hit.JanCode?.trim();
    if (!hit.Code || !hit.Name || !Number.isFinite(price) || price <= 0) return [];
    return [{
      externalId: hit.Code,
      productName: hit.Name,
      brand: hit.Brand?.Name ?? null,
      identifiers: jan ? [{ type: "JAN" as const, value: jan }] : [],
      cost: price,
      shippingCost: null,
      inventory: null,
      orderability: "UNKNOWN" as const,
      currency: "JPY",
      sourceUrl: hit.Url ?? hit.Seller?.Url ?? null,
    }];
  });
}

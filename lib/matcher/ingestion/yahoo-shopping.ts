import type { SourceProduct } from "./types";

// Yahoo Shopping V3 uses lower-camel-case JSON fields. Uppercase aliases are
// retained defensively for older fixtures/responses, but are not the primary contract.
type YahooHit = {
  code?: string;
  name?: string;
  janCode?: string;
  price?: number;
  url?: string;
  image?: { small?: string; medium?: string };
  exImage?: { url?: string; width?: number; height?: number };
  inStock?: boolean;
  condition?: string;
  seller?: { sellerId?: string; name?: string; url?: string };
  brand?: { id?: number; name?: string };
  Code?: string;
  Name?: string;
  JanCode?: string;
  Price?: number;
  Url?: string;
  InStock?: boolean;
  Condition?: string;
  Seller?: { SellerId?: string; Name?: string; Url?: string };
  Brand?: { Id?: number; Name?: string };
};

type YahooResponse = {
  hits?: YahooHit[];
  totalResultsAvailable?: number;
  totalResultsReturned?: number;
};

export async function searchYahooShopping(query: string, signal?: AbortSignal): Promise<SourceProduct[]> {
  const appId = process.env.MATCHER_YAHOO_SHOPPING_APP_ID?.trim();
  if (!appId) throw new Error("YAHOO_SHOPPING_APP_ID_NOT_CONFIGURED");
  const url = new URL("https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch");
  url.searchParams.set("appid", appId);
  url.searchParams.set("query", query);
  url.searchParams.set("sort", "-score");
  url.searchParams.set("condition", "new");
  url.searchParams.set("results", "50");
  url.searchParams.set("image_size", "300");
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`YAHOO_SHOPPING_HTTP_${response.status}`);
  const body = (await response.json()) as YahooResponse;
  if (!Array.isArray(body.hits)) {
    if (Number(body.totalResultsReturned ?? 0) > 0) throw new Error("YAHOO_SHOPPING_RESPONSE_INVALID");
    return [];
  }

  const products = body.hits.flatMap((hit) => {
    const externalId = hit.code ?? hit.Code;
    const productName = hit.name ?? hit.Name;
    const price = Number(hit.price ?? hit.Price);
    const jan = (hit.janCode ?? hit.JanCode)?.trim();
    if (!externalId || !productName || !Number.isFinite(price) || price <= 0) return [];
    const inStock = hit.inStock ?? hit.InStock;
    const sellerUrl = hit.seller?.url ?? hit.Seller?.Url;
    return [{
      sourceKey: "yahoo-shopping",
      externalId,
      productName,
      brand: hit.brand?.name ?? hit.Brand?.Name ?? null,
      identifiers: jan ? [{ type: "JAN" as const, value: jan }] : [],
      cost: price,
      shippingCost: null,
      inventory: null,
      orderability: inStock === true ? "ORDERABLE" as const : inStock === false ? "OUT_OF_STOCK" as const : "UNKNOWN" as const,
      currency: "JPY",
      condition: hit.condition ?? hit.Condition ?? null,
      sourceUrl: hit.url ?? hit.Url ?? sellerUrl ?? null,
      imageUrl: hit.exImage?.url ?? hit.image?.medium ?? hit.image?.small ?? null,
    }];
  });
  if (body.hits.length > 0 && products.length === 0) throw new Error("YAHOO_SHOPPING_ITEMS_UNPARSEABLE");
  if (Number(body.totalResultsReturned ?? 0) > 0 && body.hits.length === 0) throw new Error("YAHOO_SHOPPING_RESPONSE_INCONSISTENT");
  return products;
}

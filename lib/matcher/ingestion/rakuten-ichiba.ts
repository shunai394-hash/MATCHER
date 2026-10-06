import type { SourceProduct } from "./types";

type RakutenItem = { itemCode?: string; itemName?: string; itemPrice?: number; itemUrl?: string; jan?: string };
type RakutenResponse = { Items?: Array<{ Item?: RakutenItem }> };

export async function searchRakutenIchiba(query: string, signal?: AbortSignal): Promise<SourceProduct[]> {
  const applicationId = process.env.MATCHER_RAKUTEN_APPLICATION_ID?.trim();
  const accessKey = process.env.MATCHER_RAKUTEN_ACCESS_KEY?.trim();
  if (!applicationId || !accessKey) throw new Error("RAKUTEN_ICHIBA_CREDENTIALS_NOT_CONFIGURED");
  const url = new URL("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701");
  url.searchParams.set("applicationId", applicationId);
  url.searchParams.set("accessKey", accessKey);
  url.searchParams.set("keyword", query);
  url.searchParams.set("sort", "+itemPrice");
  url.searchParams.set("availability", "1");
  url.searchParams.set("hits", "30");
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("RAKUTEN_ICHIBA_HTTP_" + response.status);
  const body = (await response.json()) as RakutenResponse;
  return (body.Items ?? []).flatMap(({ Item: item }) => {
    if (!item?.itemCode || !item.itemName || !Number.isFinite(Number(item.itemPrice))) return [];
    return [{
      sourceKey: "rakuten-ichiba", externalId: item.itemCode, productName: item.itemName, identifiers: item.jan ? [{ type: "JAN" as const, value: item.jan }] : [], cost: Number(item.itemPrice), shippingCost: null, inventory: 1, orderability: "ORDERABLE" as const, currency: "JPY", sourceUrl: item.itemUrl ?? null }];
  });
}

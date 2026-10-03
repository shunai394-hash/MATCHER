export type MarketSource = "KAKAKU" | "EBAY";

export type SourceSearchRequest = {
  query?: string;
  gtin?: string;
  marketplace?: string;
  limit?: number;
};

export type SourceListing = {
  source: MarketSource;
  sourceProductId: string;
  title: string;
  price: number | null;
  currency: string | null;
  shippingCost: number | null;
  inventory: number | null;
  condition: string | null;
  sourceUrl: string | null;
  observedAt: string;
};

export interface MarketSourceAdapter {
  search(request: SourceSearchRequest): Promise<SourceListing[]>;
}

/**
 * Price.com API is an authenticated partner service. Price.com documents
 * its API as an external product/listing reference service available after
 * store participation, so MATCHER deliberately does not scrape its public
 * pages. Configure KAKAKU_API_BASE_URL and KAKAKU_API_TOKEN when authorized.
 */
export function createKakakuAdapter(): MarketSourceAdapter {
  return {
    async search(request) {
      const base = process.env.KAKAKU_API_BASE_URL;
      const token = process.env.KAKAKU_API_TOKEN;
      if (!base || !token) throw new Error("KAKAKU_API_CONFIG_MISSING");

      const url = new URL(base);
      if (request.query) url.searchParams.set("q", request.query);
      if (request.gtin) url.searchParams.set("gtin", request.gtin);
      url.searchParams.set("limit", String(Math.min(50, Math.max(1, request.limit ?? 20))));

      const response = await fetch(url, {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("KAKAKU_API_FAILED");

      const data = await response.json() as { items?: Array<Record<string, unknown>> };
      return (data.items ?? []).map((item) => ({
        source: "KAKAKU",
        sourceProductId: String(item.id ?? item.productId ?? ""),
        title: String(item.title ?? item.name ?? ""),
        price: item.price == null ? null : Number(item.price),
        currency: String(item.currency ?? "JPY"),
        shippingCost: item.shippingCost == null ? null : Number(item.shippingCost),
        inventory: item.inventory == null ? null : Number(item.inventory),
        condition: item.condition == null ? null : String(item.condition),
        sourceUrl: item.url == null ? null : String(item.url),
        observedAt: new Date().toISOString(),
      }));
    },
  };
}

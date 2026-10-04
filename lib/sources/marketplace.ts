/**
 * Supplier-side source adapters (eBay Browse API, Price.com / 価格.com partner API).
 *
 * search()      → raw API call (requires credentials; never returns fabricated data)
 * normalize*()  → pure: raw API item → SourceListing, or a rejection with the reason
 * toSupplierItem() → SourceListing → ingest SupplierItem (validated again by the ingest path)
 *
 * Missing credentials raise SourceConfigError (HTTP 503 at the API layer); upstream failures
 * raise SourceUpstreamError (HTTP 502, 429 kept as 429). Nothing is reported as success
 * unless the upstream returned data.
 */
import type { SupplierItem } from "../matcher/ingest-validation.ts";

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
  /** Seller / shop; becomes the supplier. */
  sellerKey: string;
  sellerName: string;
  title: string;
  brand: string | null;
  modelNumber: string | null;
  gtin: string | null;
  price: number;
  currency: string;
  shippingCost: number | null;
  inventory: number | null;
  orderable: boolean;
  condition: string | null;
  sourceUrl: string | null;
  observedAt: string;
};

export type Rejection = { sourceProductId: string | null; reason: string };
export type Normalized = { listings: SourceListing[]; rejected: Rejection[] };

export class SourceConfigError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export class SourceUpstreamError extends Error {
  code: string;
  status: number;
  detail?: unknown;
  constructor(code: string, status: number, detail?: unknown) { super(code); this.code = code; this.status = status; this.detail = detail; }
}

export interface MarketSourceAdapter {
  source: MarketSource;
  search(request: SourceSearchRequest): Promise<Normalized>;
}

const TIMEOUT_MS = 15_000;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,\s¥円]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const currencyCode = (value: unknown) => {
  const c = text(value)?.toUpperCase() ?? null;
  return c && /^[A-Z]{3}$/.test(c) ? c : null;
};
const gtinOf = (value: unknown) => {
  const digits = (typeof value === "string" || typeof value === "number" ? String(value) : "").replace(/\D/g, "");
  return [12, 13, 14].includes(digits.length) ? digits : null;
};

/* ------------------------------- eBay ------------------------------- */

/** eBay Browse API item_summary → SourceListing. Inventory is not part of item summaries, so it stays unknown. */
export function normalizeEbayItem(item: Record<string, unknown>, observedAt: string): SourceListing | Rejection {
  const id = text(item.itemId);
  if (!id) return { sourceProductId: null, reason: "MISSING_ITEM_ID" };
  const title = text(item.title);
  if (!title) return { sourceProductId: id, reason: "MISSING_TITLE" };
  const priceObj = (item.price ?? {}) as Record<string, unknown>;
  const price = num(priceObj.value);
  const currency = currencyCode(priceObj.currency);
  if (price === null || price < 0) return { sourceProductId: id, reason: "INVALID_PRICE" };
  if (!currency) return { sourceProductId: id, reason: "INVALID_CURRENCY" };

  // Shipping counts only when eBay states a fixed cost in the same currency.
  let shippingCost: number | null = null;
  const options = Array.isArray(item.shippingOptions) ? item.shippingOptions as Array<Record<string, unknown>> : [];
  const fixed = options.find((o) => o && (o.shippingCostType === "FIXED" || o.shippingCostType === undefined) && o.shippingCost);
  if (fixed) {
    const cost = (fixed.shippingCost ?? {}) as Record<string, unknown>;
    if (currencyCode(cost.currency) === currency) shippingCost = num(cost.value);
  }
  const availability = Array.isArray(item.estimatedAvailabilities) ? item.estimatedAvailabilities as Array<Record<string, unknown>> : [];
  const availableQuantity = availability
    .map((entry) => num(entry.estimatedAvailableQuantity))
    .find((value): value is number => value !== null && value >= 0) ?? null;
  const seller = (item.seller ?? {}) as Record<string, unknown>;
  const username = text(seller.username);
  const buying = Array.isArray(item.buyingOptions) ? item.buyingOptions as string[] : [];
  return {
    source: "EBAY",
    sourceProductId: id,
    sellerKey: username ? `ebay:${username.toLowerCase()}` : "ebay",
    sellerName: username ? `eBay / ${username}` : "eBay",
    title,
    brand: null,
    modelNumber: null,
    gtin: gtinOf(item.gtin),
    price,
    currency,
    shippingCost,
    inventory: availableQuantity,
    // Auctions cannot be ordered at a known price.
    orderable: buying.includes("FIXED_PRICE"),
    condition: text(item.condition),
    sourceUrl: text(item.itemWebUrl),
    observedAt,
  };
}

const ebayTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function ebayToken() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new SourceConfigError("EBAY_API_CONFIG_MISSING");
  const cached = ebayTokenCache.get(id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new SourceUpstreamError("EBAY_TOKEN_FAILED", response.status === 429 ? 429 : 502);
  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new SourceUpstreamError("EBAY_TOKEN_FAILED", 502);
  ebayTokenCache.set(id, { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 0) * 1000 });
  return data.access_token;
}

export function createEbayAdapter(): MarketSourceAdapter {
  return {
    source: "EBAY",
    async search(request) {
      if (!request.query && !request.gtin) throw new SourceConfigError("QUERY_REQUIRED");
      const token = await ebayToken();
      const params = new URLSearchParams({ limit: String(Math.min(50, Math.max(1, request.limit ?? 20))) });
      if (request.query) params.set("q", request.query);
      if (request.gtin) params.set("gtin", request.gtin);
      const response = await fetch("https://api.ebay.com/buy/browse/v1/item_summary/search?" + params.toString(), {
        headers: { Authorization: "Bearer " + token, "X-EBAY-C-MARKETPLACE-ID": (request.marketplace ?? "EBAY_US").toUpperCase() },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await response.json().catch(() => null) as { itemSummaries?: unknown[] } | null;
      if (!response.ok || !data) throw new SourceUpstreamError("EBAY_SEARCH_FAILED", response.status === 429 ? 429 : 502, data);
      return normalizeAll(Array.isArray(data.itemSummaries) ? data.itemSummaries : [], normalizeEbayItem);
    },
  };
}

/* ----------------------------- 価格.com ----------------------------- */

/**
 * Price.com API is an authenticated partner service available after store participation;
 * MATCHER deliberately does not scrape its public pages. Configure KAKAKU_API_BASE_URL and
 * KAKAKU_API_TOKEN when authorized. Field names follow the partner feed (id/productId,
 * title/name, price, shippingCost, inventory/stock, jan, maker/brand, model, shopId/shopName).
 */
export function normalizeKakakuItem(item: Record<string, unknown>, observedAt: string): SourceListing | Rejection {
  const id = text(String(item.id ?? item.productId ?? ""));
  if (!id) return { sourceProductId: null, reason: "MISSING_ITEM_ID" };
  const title = text(item.title ?? item.name);
  if (!title) return { sourceProductId: id, reason: "MISSING_TITLE" };
  const price = num(item.price);
  if (price === null || price < 0) return { sourceProductId: id, reason: "INVALID_PRICE" };
  const currency = currencyCode(item.currency ?? "JPY");
  if (!currency) return { sourceProductId: id, reason: "INVALID_CURRENCY" };
  const inventory = num(item.inventory ?? item.stock);
  const shopId = text(String(item.shopId ?? "")) ?? text(item.shopName);
  const shopName = text(item.shopName);
  return {
    source: "KAKAKU",
    sourceProductId: id,
    sellerKey: shopId ? `kakaku:${shopId.toLowerCase()}` : "kakaku",
    sellerName: shopName ? `価格.com / ${shopName}` : "価格.com",
    title,
    brand: text(item.brand ?? item.maker),
    modelNumber: text(item.model ?? item.modelNumber),
    gtin: gtinOf(item.jan ?? item.gtin),
    price,
    currency,
    shippingCost: num(item.shippingCost),
    inventory: inventory !== null && Number.isInteger(inventory) && inventory >= 0 ? inventory : null,
    orderable: item.orderable === undefined ? true : item.orderable === true,
    condition: text(item.condition),
    sourceUrl: text(item.url),
    observedAt,
  };
}

export function createKakakuAdapter(): MarketSourceAdapter {
  return {
    source: "KAKAKU",
    async search(request) {
      const base = process.env.KAKAKU_API_BASE_URL;
      const token = process.env.KAKAKU_API_TOKEN;
      if (!base || !token) throw new SourceConfigError("KAKAKU_API_CONFIG_MISSING");
      if (!request.query && !request.gtin) throw new SourceConfigError("QUERY_REQUIRED");
      const url = new URL(base);
      if (request.query) url.searchParams.set("q", request.query);
      if (request.gtin) url.searchParams.set("gtin", request.gtin);
      url.searchParams.set("limit", String(Math.min(50, Math.max(1, request.limit ?? 20))));
      const response = await fetch(url, {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await response.json().catch(() => null) as { items?: unknown[] } | null;
      if (!response.ok || !data) throw new SourceUpstreamError("KAKAKU_API_FAILED", response.status === 429 ? 429 : 502, data);
      return normalizeAll(Array.isArray(data.items) ? data.items : [], normalizeKakakuItem);
    },
  };
}

/* ------------------------------ shared ------------------------------ */

export function normalizeAll(items: unknown[], normalize: (item: Record<string, unknown>, observedAt: string) => SourceListing | Rejection): Normalized {
  const observedAt = new Date().toISOString();
  const out: Normalized = { listings: [], rejected: [] };
  for (const raw of items) {
    if (!raw || typeof raw !== "object") {
      out.rejected.push({ sourceProductId: null, reason: "NOT_AN_OBJECT" });
      continue;
    }
    const result = normalize(raw as Record<string, unknown>, observedAt);
    if ("reason" in result) out.rejected.push(result);
    else out.listings.push(result);
  }
  return out;
}

export function adapterFor(source: string): MarketSourceAdapter | null {
  if (source === "EBAY") return createEbayAdapter();
  if (source === "KAKAKU") return createKakakuAdapter();
  return null;
}

/** A listing becomes a supplier product + offer observation; unknown facts stay unknown. */
export function toSupplierItem(listing: SourceListing): SupplierItem {
  const gtinType = listing.gtin ? (listing.gtin.length === 12 ? "UPC" : listing.gtin.length === 13 ? "JAN" : "EAN") : null;
  return {
    supplierKey: listing.sellerKey,
    supplierName: listing.sellerName,
    supplierProductId: listing.sourceProductId,
    productName: listing.title,
    brand: listing.brand ?? undefined,
    modelNumber: listing.modelNumber ?? undefined,
    condition: listing.condition ?? undefined,
    sourceUrl: listing.sourceUrl ?? undefined,
    cost: listing.price,
    shippingCost: listing.shippingCost ?? undefined,
    inventory: listing.inventory ?? undefined,
    orderability: listing.orderable ? (listing.inventory === 0 ? "OUT_OF_STOCK" : "ORDERABLE") : "BLOCKED",
    currency: listing.currency,
    observedAt: listing.observedAt,
    identifiers: listing.gtin && gtinType ? [{ type: gtinType, value: listing.gtin }] : [],
  };
}

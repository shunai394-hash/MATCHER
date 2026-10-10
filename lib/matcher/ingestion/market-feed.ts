type MarketFeedItem = {
  identifierType: "JAN" | "EAN" | "UPC";
  identifierValue: string;
  source: string;
  windowStart: string;
  windowEnd: string;
  salesCount: number;
  activeListingCount: number;
  medianSalePrice: number;
  priceStddev: number;
  observedAt: string;
  evidenceUrl: string;
};

export function publicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
    const private172 = host.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    if (host === "::1" || host === "[::1]" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
    return true;
  } catch {
    return false;
  }
}

export function validateMarketFeedItem(value: unknown): { item?: MarketFeedItem; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "INVALID_ITEM" };
  const row = value as Record<string, unknown>;
  const identifierType = row.identifierType;
  if (identifierType !== "JAN" && identifierType !== "EAN" && identifierType !== "UPC") return { error: "INVALID_IDENTIFIER_TYPE" };
  if (typeof row.identifierValue !== "string") return { error: "INVALID_IDENTIFIER" };
  const identifierValue = normalizeIdentifier(row.identifierValue);
  if (!identifierValue || !isValidGlobalIdentifier(identifierValue, identifierType)) return { error: "INVALID_GLOBAL_IDENTIFIER" };
  if (typeof row.source !== "string" || !/^[a-z0-9][a-z0-9._-]{0,39}$/i.test(row.source)) return { error: "INVALID_MARKET_SOURCE" };
  if (typeof row.windowStart !== "string" || typeof row.windowEnd !== "string" || typeof row.observedAt !== "string") return { error: "INVALID_OBSERVATION_WINDOW" };
  const start = Date.parse(row.windowStart);
  const end = Date.parse(row.windowEnd);
  const observed = Date.parse(row.observedAt);
  if (![start, end, observed].every(Number.isFinite) || end <= start || observed > Date.now() + 60_000) return { error: "INVALID_OBSERVATION_DATES" };
  if (!Number.isInteger(row.salesCount) || Number(row.salesCount) <= 0) return { error: "NO_SALES_EVIDENCE" };
  if (!Number.isInteger(row.activeListingCount) || Number(row.activeListingCount) < 0) return { error: "INVALID_LISTING_COUNT" };
  if (typeof row.medianSalePrice !== "number" || !Number.isFinite(row.medianSalePrice) || row.medianSalePrice <= 0) return { error: "INVALID_MEDIAN_SALE_PRICE" };
  if (typeof row.priceStddev !== "number" || !Number.isFinite(row.priceStddev) || row.priceStddev < 0) return { error: "INVALID_PRICE_STDDEV" };
  if (!publicHttpsUrl(row.evidenceUrl)) return { error: "INVALID_EVIDENCE_URL" };
  return {
    item: {
      identifierType,
      identifierValue,
      source: row.source.toLowerCase(),
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(end).toISOString(),
      salesCount: Number(row.salesCount),
      activeListingCount: Number(row.activeListingCount),
      medianSalePrice: row.medianSalePrice,
      priceStddev: row.priceStddev,
      observedAt: new Date(observed).toISOString(),
      evidenceUrl: row.evidenceUrl,
    },
  };
}

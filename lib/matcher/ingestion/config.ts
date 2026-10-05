import { createJsonFeedAdapter } from "./json-feed";
import type { SourceAdapter } from "./types";

export function configuredSupplierAdapter(): SourceAdapter | null {
  const url = process.env.MATCHER_SUPPLIER_FEED_URL?.trim();
  if (!url) return null;
  return createJsonFeedAdapter(url, process.env.MATCHER_SUPPLIER_SOURCE_KEY?.trim() || "configured-json-feed");
}

export function ingestionConfiguration() {
  const yahoo = Boolean(process.env.MATCHER_YAHOO_SHOPPING_APP_ID?.trim());
  const rakuten = Boolean(process.env.MATCHER_RAKUTEN_APPLICATION_ID?.trim() && process.env.MATCHER_RAKUTEN_ACCESS_KEY?.trim());
  const feed = Boolean(process.env.MATCHER_SUPPLIER_FEED_URL?.trim());
  return {
    configured: yahoo || rakuten || feed,
    sources: {
      yahoo: { configured: yahoo, missing: yahoo ? [] : ["MATCHER_YAHOO_SHOPPING_APP_ID"] },
      rakuten: { configured: rakuten, missing: rakuten ? [] : ["MATCHER_RAKUTEN_APPLICATION_ID", "MATCHER_RAKUTEN_ACCESS_KEY"] },
      feed: { configured: feed, missing: feed ? [] : ["MATCHER_SUPPLIER_FEED_URL"] },
    },
  };
}

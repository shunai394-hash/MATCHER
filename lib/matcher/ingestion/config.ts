import { createJsonFeedAdapter } from "./json-feed";
import type { SourceAdapter } from "./types";

export function configuredSupplierAdapter(): SourceAdapter | null {
  const url = process.env.MATCHER_SUPPLIER_FEED_URL?.trim();
  if (!url) return null;
  return createJsonFeedAdapter(url, process.env.MATCHER_SUPPLIER_SOURCE_KEY?.trim() || "configured-json-feed");
}

export function ingestionConfiguration() {
  return {
    configured: Boolean(process.env.MATCHER_SUPPLIER_FEED_URL?.trim()),
    sourceKey: process.env.MATCHER_SUPPLIER_SOURCE_KEY?.trim() || "configured-json-feed",
  };
}
import type { SourceAdapter, SourceProduct } from "./types";
import { normalizeSourceProduct } from "./normalize";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseItem(value: unknown): SourceProduct | null {
  if (!isRecord(value)) return null;
  if (typeof value.externalId !== "string" || typeof value.productName !== "string") return null;
  return normalizeSourceProduct(value as unknown as SourceProduct);
}

export function createJsonFeedAdapter(url: string, key = "json-feed"): SourceAdapter {
  return {
    key,
    async discover(signal) {
      const response = await fetch(url, { headers: { accept: "application/json" }, signal, cache: "no-store" });
      if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
      const body: unknown = await response.json();
      const items = isRecord(body) && Array.isArray(body.items) ? body.items : body;
      if (!Array.isArray(items)) throw new Error("SOURCE_PAYLOAD_NOT_ARRAY");
      return items.map(parseItem).filter((x): x is SourceProduct => x !== null);
    },
  };
}
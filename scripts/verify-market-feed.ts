import { validateMarketFeedItem } from "../app/api/ingestion/market/route.ts";

const valid = {
  identifierType: "JAN",
  identifierValue: "4902370553024",
  source: "marketplace-key",
  windowStart: "2026-10-01T00:00:00.000Z",
  windowEnd: "2026-10-08T00:00:00.000Z",
  salesCount: 12,
  activeListingCount: 35,
  medianSalePrice: 12345,
  priceStddev: 850,
  observedAt: "2026-10-10T00:00:00.000Z",
  evidenceUrl: "https://example.com/real-sales-evidence",
};
if (!validateMarketFeedItem(valid).item) throw new Error("valid market evidence was rejected");
if (validateMarketFeedItem({ ...valid, identifierValue: "4902370553025" }).error !== "INVALID_GLOBAL_IDENTIFIER") {
  throw new Error("invalid JAN check digit was accepted");
}
if (validateMarketFeedItem({ ...valid, salesCount: 0 }).error !== "NO_SALES_EVIDENCE") {
  throw new Error("zero-sales record was accepted as profit evidence");
}
if (validateMarketFeedItem({ ...valid, evidenceUrl: "https://127.0.0.1/private" }).error !== "INVALID_EVIDENCE_URL") {
  throw new Error("private evidence URL was accepted");
}
if (validateMarketFeedItem({ ...valid, windowEnd: "2026-09-01T00:00:00.000Z" }).error !== "INVALID_OBSERVATION_DATES") {
  throw new Error("invalid observation window was accepted");
}
console.log("verify:market-feed PASS");

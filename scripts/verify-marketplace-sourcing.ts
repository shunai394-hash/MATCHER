import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  createEbayAdapter,
  createKakakuAdapter,
  normalizeEbayItem,
  normalizeKakakuItem,
  SourceConfigError,
  SourceUpstreamError,
  toSupplierItem,
  type SourceListing,
} from "../lib/sources/marketplace.ts";
import { validateSupplierItem } from "../lib/matcher/ingest-validation.ts";

const now = "2026-10-03T09:00:00.000Z";
const isListing = (v: unknown): v is SourceListing => !!v && typeof v === "object" && !("reason" in v);

// eBay item_summary normalization.
const ebay = normalizeEbayItem({
  itemId: "v1|1234|0",
  title: "ACME AX-204 Wireless Earbuds Black",
  price: { value: "42.50", currency: "USD" },
  shippingOptions: [{ shippingCostType: "FIXED", shippingCost: { value: "5.00", currency: "USD" } }],
  seller: { username: "GoodSeller" },
  buyingOptions: ["FIXED_PRICE"],
  condition: "New",
  itemWebUrl: "https://www.ebay.com/itm/1234",
  gtin: "0012345678905",
}, now);
assert.ok(isListing(ebay));
assert.equal(ebay.price, 42.5);
assert.equal(ebay.currency, "USD");
assert.equal(ebay.shippingCost, 5);
assert.equal(ebay.inventory, null, "eBay item summaries carry no stock count: inventory must stay unknown");
assert.equal(ebay.sellerKey, "ebay:goodseller");
assert.equal(ebay.orderable, true);
const ebayItem = toSupplierItem(ebay);
assert.deepEqual(validateSupplierItem(ebayItem, 0), []);
assert.equal(ebayItem.inventory, undefined);
assert.equal(ebayItem.identifiers?.[0].type, "JAN"); // 13 digits = GTIN-13; matching compares all GTIN types as GTIN-14

// Rejections instead of silent coercion.
assert.equal((normalizeEbayItem({ title: "x", price: { value: "1", currency: "USD" } }, now) as { reason: string }).reason, "MISSING_ITEM_ID");
assert.equal((normalizeEbayItem({ itemId: "a", title: "x", price: { value: "abc", currency: "USD" } }, now) as { reason: string }).reason, "INVALID_PRICE");
assert.equal((normalizeEbayItem({ itemId: "a", title: "x", price: { value: "1", currency: "dollars" } }, now) as { reason: string }).reason, "INVALID_CURRENCY");
// Shipping in another currency or calculated shipping stays unknown; auctions are not orderable.
const auction = normalizeEbayItem({ itemId: "b", title: "y", price: { value: "10", currency: "USD" }, buyingOptions: ["AUCTION"], shippingOptions: [{ shippingCostType: "CALCULATED" }] }, now);
assert.ok(isListing(auction));
assert.equal(auction.shippingCost, null);
assert.equal(toSupplierItem(auction).orderability, "BLOCKED");

// 価格.com partner feed normalization.
const kakaku = normalizeKakakuItem({ id: 987, name: "ACME AX-204", price: "4,980", shippingCost: 600, stock: 3, jan: "4901234567894", maker: "ACME", model: "AX-204", shopId: "S1", shopName: "Shop One", url: "https://kakaku.example/987" }, now);
assert.ok(isListing(kakaku));
assert.equal(kakaku.price, 4980);
assert.equal(kakaku.currency, "JPY");
assert.equal(kakaku.inventory, 3);
assert.equal(kakaku.gtin, "4901234567894");
const kakakuItem = toSupplierItem(kakaku);
assert.deepEqual(validateSupplierItem(kakakuItem, 0), []);
assert.equal(kakakuItem.identifiers?.[0].type, "JAN");
assert.equal(toSupplierItem({ ...kakaku, inventory: 0 }).orderability, "OUT_OF_STOCK");
assert.equal((normalizeKakakuItem({ id: 1, name: "x", price: -5 }, now) as { reason: string }).reason, "INVALID_PRICE");
assert.equal((normalizeKakakuItem({ id: 1, name: "x", price: 5, stock: 2.5 }, now) as SourceListing).inventory, null);

async function main() {
  // Missing credentials: explicit error, no network call, no data.
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("network must not be used"); }) as typeof fetch;
  delete process.env.EBAY_CLIENT_ID; delete process.env.EBAY_CLIENT_SECRET;
  delete process.env.KAKAKU_API_BASE_URL; delete process.env.KAKAKU_API_TOKEN;
  await assert.rejects(createEbayAdapter().search({ query: "x" }), (e: unknown) => e instanceof SourceConfigError && e.code === "EBAY_API_CONFIG_MISSING");
  await assert.rejects(createKakakuAdapter().search({ query: "x" }), (e: unknown) => e instanceof SourceConfigError && e.code === "KAKAKU_API_CONFIG_MISSING");
  assert.equal(calls, 0);

  // Upstream errors are surfaced (429 stays 429; others are 502), never turned into empty success.
  process.env.KAKAKU_API_BASE_URL = "https://kakaku.example/api"; process.env.KAKAKU_API_TOKEN = "t";
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "slow down" }), { status: 429 })) as typeof fetch;
  await assert.rejects(createKakakuAdapter().search({ query: "x" }), (e: unknown) => e instanceof SourceUpstreamError && e.status === 429);
  globalThis.fetch = (async () => new Response("<html>oops</html>", { status: 500 })) as typeof fetch;
  await assert.rejects(createKakakuAdapter().search({ query: "x" }), (e: unknown) => e instanceof SourceUpstreamError && e.status === 502);
  // A successful upstream response is normalized; bad rows are reported, not dropped silently.
  let requested = "";
  globalThis.fetch = (async (url: string | URL) => { requested = String(url); return new Response(JSON.stringify({ items: [{ id: 1, name: "ok", price: 100 }, { name: "no id", price: 1 }, "junk"] }), { status: 200 }); }) as typeof fetch;
  const result = await createKakakuAdapter().search({ gtin: "4901234567894", limit: 500 });
  assert.equal(result.listings.length, 1);
  assert.deepEqual(result.rejected.map((r) => r.reason), ["MISSING_ITEM_ID", "NOT_AN_OBJECT"]);
  assert.ok(requested.includes("gtin=4901234567894") && requested.includes("limit=50"));
  globalThis.fetch = realFetch;

  // Import route wiring.
  const importRoute = readFileSync("app/api/sources/import/route.ts", "utf8");
  for (const needle of ["hasOpsToken", "SourceConfigError", "runIngestion", "validateSupplierItem"]) assert.ok(importRoute.includes(needle), needle);
  console.log("MATCHER marketplace sourcing checks: PASS");
}

main().catch((error) => { console.error(error); process.exit(1); });

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const files = {
  ebay: readFileSync("app/api/sources/ebay/search/route.ts", "utf8"),
  adapters: readFileSync("lib/sources/marketplace.ts", "utf8"),
  ingest: readFileSync("app/api/ingest/route.ts", "utf8"),
  recompute: readFileSync("app/api/opportunities/recompute/route.ts", "utf8"),
};
assert.ok(files.ebay.includes("EBAY_CLIENT_ID"));
assert.ok(files.ebay.includes("X-EBAY-C-MARKETPLACE-ID"));
assert.ok(files.ebay.includes("gtin"));
assert.ok(files.ebay.includes("shippingOptions"));
assert.ok(files.adapters.includes("KAKAKU_API_BASE_URL"));
assert.ok(files.adapters.includes("KAKAKU_API_TOKEN"));
assert.ok(files.ingest.includes("supplierItems"));
assert.ok(files.ingest.includes("marketObservations"));
assert.ok(files.recompute.includes("expectedProfit"));
for (const [name, source] of Object.entries(files)) assert.equal(source.includes("\\n"), false, name + ": escaped newline artifact");
console.log("MATCHER marketplace sourcing checks: PASS");

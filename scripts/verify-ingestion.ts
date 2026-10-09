import { normalizeSourceProduct } from "../lib/matcher/ingestion/normalize.ts";
import { validateSourceProduct } from "../lib/matcher/ingestion/validate.ts";
import { searchYahooShopping } from "../lib/matcher/ingestion/yahoo-shopping.ts";

const valid = normalizeSourceProduct({
  externalId: "  sku-1 ",
  productName: "  Example Product ",
  currency: "jpy",
  identifiers: [{ type: "JAN", value: "4901234567894" }, { type: "JAN", value: "4901234567894" }],
  cost: 1000,
  shippingCost: 300,
  inventory: 4,
});
const errors = validateSourceProduct(valid);
if (errors.length) throw new Error(errors.join(","));
if (valid.externalId !== "sku-1" || valid.productName !== "Example Product" || valid.identifiers?.length !== 1) {
  throw new Error("NORMALIZATION_REGRESSION");
}

const invalid = validateSourceProduct({ ...valid, inventory: -1 });
if (!invalid.includes("INVENTORY_INVALID")) throw new Error("VALIDATION_REGRESSION");

const originalFetch = globalThis.fetch;
const requestedUrls: string[] = [];
const previousAppId = process.env.MATCHER_YAHOO_SHOPPING_APP_ID;
process.env.MATCHER_YAHOO_SHOPPING_APP_ID = "test-app-id";
try {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({
    totalResultsAvailable: 1,
    totalResultsReturned: 1,
    hits: [{
      code: "store_item_1",
      name: "Example earbuds",
      janCode: "4901234567894",
      price: 4980,
      url: "https://store.shopping.yahoo.co.jp/example/item.html",
      inStock: true,
      condition: "new",
      brand: { name: "Example" },
      seller: { sellerId: "example", name: "Example Store", url: "https://store.shopping.yahoo.co.jp/example/" },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const yahooItems = await searchYahooShopping("Example earbuds");
  if (yahooItems.length !== 1) throw new Error("YAHOO_V3_LOWERCASE_FIELDS_NOT_PARSED");
  if (yahooItems[0].externalId !== "store_item_1" || yahooItems[0].productName !== "Example earbuds") {
    throw new Error("YAHOO_V3_IDENTITY_FIELDS_NOT_PARSED");
  }
  if (yahooItems[0].cost !== 4980 || yahooItems[0].identifiers?.[0]?.value !== "4901234567894") {
    throw new Error("YAHOO_V3_PRICE_OR_JAN_NOT_PARSED");
  }
  if (yahooItems[0].orderability !== "ORDERABLE") throw new Error("YAHOO_V3_STOCK_NOT_PARSED");
  const requestUrl = requestedUrls[0] ? new URL(requestedUrls[0]) : null;
  if (requestUrl?.searchParams.get("sort") !== "-score") throw new Error("YAHOO_SEARCH_MUST_PRIORITIZE_RELEVANCE");
} finally {
  globalThis.fetch = originalFetch;
  if (previousAppId === undefined) delete process.env.MATCHER_YAHOO_SHOPPING_APP_ID;
  else process.env.MATCHER_YAHOO_SHOPPING_APP_ID = previousAppId;
}

console.log("PASS ingestion normalization + validation + Yahoo Shopping V3 field mapping");

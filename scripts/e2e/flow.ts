import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

/**
 * E2E scenario against the running app + real Postgres (via PostgREST).
 * Walks the buyer's morning: ingest supplier & market data → recompute → candidate list,
 * and proves that every gate (identity, stock, cost, freshness, profit, human REJECT) holds.
 */

const APP = process.env.E2E_APP!;
const REST = process.env.E2E_REST!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INGEST = process.env.MATCHER_INGEST_TOKEN!;
const CRON = process.env.CRON_SECRET!;

let step = 0;
function log(message: string) {
  step += 1;
  console.log(`  ✓ ${String(step).padStart(2, "0")} ${message}`);
}

async function api(path: string, init: RequestInit & { json?: unknown; token?: string | null } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.json !== undefined) headers["content-type"] = "application/json";
  if (init.token !== null) headers["x-matcher-ingest-token"] = init.token ?? INGEST;
  const response = await fetch(APP + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${REST}/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json", Prefer: "return=representation", ...(init.headers as Record<string, string> | undefined) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`REST ${path} ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function gtin13(prefix12: string) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(prefix12[i]) * (i % 2 === 0 ? 1 : 3);
  return prefix12 + ((10 - (sum % 10)) % 10);
}

const JAN_EARBUDS = gtin13("490123456789");
const JAN_SPEAKER = gtin13("490000000001");
const JAN_SSD = gtin13("490000000002");

async function recompute() {
  const result = await api("/api/opportunities/recompute", { method: "POST" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
async function opportunities(query = "") {
  const result = await api("/api/opportunities" + query, { token: null });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
async function ingest(payload: unknown) {
  return api("/api/ingest", { method: "POST", json: payload });
}
async function count(table: string, filter = "") {
  const response = await fetch(`${REST}/${table}?select=id${filter ? "&" + filter : ""}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact", Range: "0-0" } });
  return Number(response.headers.get("content-range")?.split("/")[1] ?? "NaN");
}

const supplierA = (overrides: Record<string, unknown> = {}) => ({
  supplierKey: "netsea", supplierName: "NETSEA", supplierProductId: "NS-1001", supplierSku: "AX204-BK",
  productName: "ACME ワイヤレスイヤホン AX-204 ブラック", brand: "ACME", modelNumber: "AX-204", color: "BLACK",
  sourceUrl: "https://example.test/netsea/NS-1001", cost: 4100, shippingCost: 600, inventory: 5, orderability: "ORDERABLE",
  identifiers: [{ type: "JAN", value: JAN_EARBUDS }], ...overrides,
});

/** Optional: E2E_SCREENSHOT_DIR=<dir> captures the candidate page with a globally installed Playwright. */
async function screenshot(name: string) {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (!dir) return;
  const require = createRequire(execSync("npm root -g").toString().trim() + "/");
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  for (const [suffix, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
    const page = await browser.newPage({ viewport });
    await page.goto(APP + "/opportunities");
    await page.waitForSelector(".opportunity-card, .opportunity-empty");
    await page.screenshot({ path: `${dir}/${name}-${suffix}.png`, fullPage: true });
    await page.close();
  }
  await browser.close();
}

async function main() {
  console.log("MATCHER E2E (Postgres + PostgREST + next start)");

  // 1. Empty database: honest empty state, never invented candidates.
  const empty = await opportunities();
  assert.deepEqual(empty.opportunities, []);
  assert.equal(empty.total, 0);
  log("empty DB → no opportunities, no fabricated data");
  await screenshot("opportunities-empty");

  // 2. Canonical products (product master is maintained outside the ingest feed).
  const [earbuds, speaker, ssd] = await rest("master_product", { method: "POST", body: JSON.stringify([
    { brand: "ACME", product_name: "ACME ワイヤレスイヤホン AX-204", model_number: "AX-204" },
    { brand: "SONORA", product_name: "SONORA ポータブルスピーカー SP-1", model_number: "SP-1" },
    { brand: "KIOXIA", product_name: "KIOXIA SSD EXCERIA 256GB", model_number: "SSD-CK256" },
  ]) });
  await rest("product_identifier", { method: "POST", body: JSON.stringify([
    { master_product_id: earbuds.id, identifier_type: "JAN", identifier_value: JAN_EARBUDS, normalized_value: JAN_EARBUDS },
    { master_product_id: speaker.id, identifier_type: "JAN", identifier_value: JAN_SPEAKER, normalized_value: JAN_SPEAKER },
    { master_product_id: ssd.id, identifier_type: "JAN", identifier_value: JAN_SSD, normalized_value: JAN_SSD },
  ]) });
  await rest("product_variant", { method: "POST", body: JSON.stringify([
    { master_product_id: earbuds.id, variant_key: "BLACK", color: "BLACK", capacity: null },
    { master_product_id: ssd.id, variant_key: "256GB", color: null, capacity: "256GB" },
  ]) });
  log("seeded 3 master products with JAN + variants");

  // 3. Ingest auth + validation (nothing written on invalid input).
  assert.equal((await api("/api/ingest", { method: "POST", json: { source: "x", supplierItems: [] }, token: null })).status, 401);
  assert.equal((await api("/api/opportunities/recompute", { method: "POST", token: "wrong" })).status, 401);
  const invalid = await ingest({ source: "test", supplierItems: [{ supplierKey: "netsea", supplierName: "NETSEA", supplierProductId: "X", cost: -1 }] });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.details.some((d: string) => d.includes("cost")));
  assert.equal(await count("supplier_product"), 0);
  log("ingest/recompute reject missing token (401); invalid payload → 400 and zero rows written");

  // 4. Real ingest: 4 supplier items + market prices.
  const first = await ingest({
    source: "e2e-morning-feed",
    recompute: false,
    supplierItems: [
      supplierA({ cost: 4000 }),
      // Matched by brand + model, but out of stock.
      { supplierKey: "netsea", supplierName: "NETSEA", supplierProductId: "NS-2002", productName: "SONORA SP-1", brand: "SONORA", modelNumber: "SP-1", cost: 9000, shippingCost: 800, inventory: 0, orderability: "ORDERABLE" },
      // Same JAN but capacity conflicts with the master variant → identity BLOCK.
      { supplierKey: "superdelivery", supplierName: "スーパーデリバリー", supplierProductId: "SD-77", productName: "KIOXIA SSD 128GB", brand: "KIOXIA", modelNumber: "SSD-CK256", capacity: "128GB", cost: 3000, shippingCost: 500, inventory: 10, orderability: "ORDERABLE", identifiers: [{ type: "JAN", value: JAN_SSD }] },
      // Same product as A at another supplier, but shipping is unknown.
      { ...supplierA(), supplierKey: "superdelivery", supplierName: "スーパーデリバリー", supplierProductId: "SD-88", shippingCost: undefined },
    ],
    marketObservations: [
      { masterProductId: earbuds.id, source: "amazon_jp", salePrice: 9800, paymentFee: 300, marketplaceFee: 980, tax: 0, otherCost: 100, sold: true, sourceUrl: "https://example.test/amazon/ax204" },
      { masterProductId: speaker.id, source: "amazon_jp", salePrice: 20000, paymentFee: 600, marketplaceFee: 2000, tax: 0, otherCost: 0 },
      { masterProductId: ssd.id, source: "amazon_jp", salePrice: 9000, paymentFee: 270, marketplaceFee: 900, tax: 0, otherCost: 0 },
    ],
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.ok, true);
  assert.equal(first.body.itemCount, 7);
  const products = await rest("supplier_product?select=supplier_product_id,product_name,brand,model_number,capacity,first_seen_at,last_seen_at&order=supplier_product_id");
  assert.equal(products.length, 4);
  assert.equal(products.find((p: any) => p.supplier_product_id === "NS-1001").product_name, "ACME ワイヤレスイヤホン AX-204 ブラック");
  assert.equal(await count("supplier_offer"), 4);
  const snapshots = await rest("supplier_offer_snapshot?select=supplier_cost,shipping_cost,inventory,shipping_confidence,observed_at");
  assert.equal(snapshots.length, 4);
  assert.ok(snapshots.some((s: any) => Number(s.supplier_cost) === 4000 && Number(s.shipping_cost) === 600 && s.inventory === 5 && Number(s.shipping_confidence) === 1));
  const noShipping = snapshots.find((s: any) => s.shipping_cost === null);
  assert.equal(Number(noShipping.shipping_confidence), 0);
  const freshness = await rest("supplier_offer_freshness?select=*");
  assert.equal(freshness.length, 4);
  assert.ok(freshness.every((f: any) => f.price_observed_at && f.inventory_observed_at && f.updated_at));
  assert.equal(freshness.filter((f: any) => f.shipping_observed_at === null).length, 1);
  const market = await rest("market_price_observation?select=master_product_id,source,sale_price,payment_fee,sold");
  assert.equal(market.length, 3);
  assert.equal((await rest("ingestion_run?select=status,item_count,error_count"))[0].status, "SUCCEEDED");
  log("ingest wrote supplier_product(product_name) / offer / snapshot(cost, shipping, inventory, confidence) / freshness / market rows");

  // 5. Re-ingest the same product: no offer proliferation, snapshot history grows, first_seen_at kept.
  const before = products.find((p: any) => p.supplier_product_id === "NS-1001");
  const second = await ingest({ source: "e2e-morning-feed", recompute: false, supplierItems: [supplierA({ color: undefined })] });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(await count("supplier_offer"), 4);
  assert.equal(await count("supplier_offer_snapshot"), 5);
  const after = (await rest("supplier_product?select=first_seen_at,last_seen_at,color&supplier_product_id=eq.NS-1001"))[0];
  assert.equal(after.first_seen_at, before.first_seen_at);
  assert.ok(new Date(after.last_seen_at) > new Date(before.last_seen_at));
  assert.equal(after.color, "BLACK", "a partial feed must not erase known attributes");
  log("re-ingest: still 4 offers (no duplicates), snapshot appended, first_seen_at kept, color not erased");

  // 6. Nothing is shown before the pipeline has evaluated the data.
  assert.equal((await opportunities()).opportunities.length, 0);
  log("before recompute → still no candidates (identity not yet established)");

  // 7. Recompute: identity → profit → gate.
  const r1 = await recompute();
  assert.equal(r1.identity.written, 4);
  assert.equal(r1.identity.decisions.AUTO_LINK, 3);
  assert.equal(r1.identity.decisions.BLOCK, 1);
  assert.equal(r1.offersEvaluated, 4);
  assert.equal(r1.sellable, 1, JSON.stringify(r1.blockedReasons));
  assert.ok(r1.blockedReasons.OUT_OF_STOCK >= 1);
  assert.ok(r1.blockedReasons.IDENTITY_HARD_BLOCK >= 1);
  assert.ok(r1.blockedReasons.SHIPPING_COST_UNKNOWN >= 1);
  const firstGates = await rest("quality_gate_result?select=status,blocking_reasons,supplier_offer_id");
  assert.equal(firstGates.length, 4);
  assert.ok(!r1.blockedReasons.REQUIRED_FEES_UNKNOWN, "all market fees were provided: " + JSON.stringify(firstGates));
  const matches = await rest("identity_match?select=decision,hard_block,master_product_id");
  assert.equal(matches.filter((m: any) => m.decision === "BLOCK" && m.hard_block).length, 1);
  log(`recompute: identity 3 AUTO_LINK + 1 BLOCK, ${r1.sellable} SELLABLE, blocked reasons ${Object.keys(r1.blockedReasons).join(",")}`);

  // 8. The one fully-proven offer is listed with evidence and exact profit.
  const feed = await opportunities("?minProfit=1000");
  assert.equal(feed.opportunities.length, 1, JSON.stringify(feed));
  const top = feed.opportunities[0];
  assert.equal(top.masterProductId, earbuds.id);
  assert.equal(top.supplierName, "NETSEA");
  assert.equal(top.profit.expectedProfit, 9800 - 4100 - 600 - 300 - 980 - 0 - 100);
  assert.equal(top.inventory, 5);
  assert.equal(top.gate.status, "SELLABLE");
  assert.equal(top.identity.decision, "AUTO_LINK");
  assert.ok(top.identity.evidence.some((e: any) => e.field === "JAN" && e.kind === "EXACT_IDENTIFIER"));
  assert.ok(top.freshness.price.fresh && top.freshness.inventory.fresh && top.freshness.shipping.fresh && top.freshness.market.fresh);
  assert.equal(top.supplierUrl, "https://example.test/netsea/NS-1001");
  await screenshot("opportunities-verified");
  log(`feed: 1 candidate "${top.productName}" profit ${top.profit.expectedProfit} JPY with JAN evidence + freshness`);

  // 9. Idempotent: re-running recompute writes nothing new.
  const r2 = await recompute();
  assert.equal(r2.identity.written, 0);
  assert.equal(r2.profitSnapshotsWritten, 0);
  assert.equal(r2.gateResultsWritten, 0);
  log("recompute is idempotent (0 identity / profit / gate rows on unchanged data)");

  // 10. minProfit filter.
  const high = await opportunities("?minProfit=5000");
  assert.equal(high.opportunities.length, 0);
  assert.equal(high.excluded.BELOW_MIN_PROFIT, 1);
  log("minProfit=5000 → hidden with reason BELOW_MIN_PROFIT");

  // 11. Stock runs out: hidden immediately (live check), then gate records BLOCKED.
  await ingest({ source: "e2e-stock", recompute: false, supplierItems: [supplierA({ inventory: 0 })] });
  assert.equal((await opportunities()).opportunities.length, 0);
  const r3 = await recompute();
  assert.equal(r3.sellable, 0);
  const gates = await rest(`quality_gate_result?select=status,blocking_reasons&order=evaluated_at.desc&limit=1&supplier_offer_id=eq.${top.supplierOfferId}`);
  assert.equal(gates[0].status, "BLOCKED");
  assert.ok(gates[0].blocking_reasons.includes("OUT_OF_STOCK"));
  log("inventory 0 → hidden before recompute; recompute stores BLOCKED (OUT_OF_STOCK)");

  // 12. Restocked but recompute not yet run: gate is outdated → not shown until re-evaluated.
  await ingest({ source: "e2e-stock", recompute: false, supplierItems: [supplierA({ inventory: 3 })] });
  const outdated = await opportunities();
  assert.equal(outdated.opportunities.length, 0);
  await recompute();
  assert.equal((await opportunities()).opportunities.length, 1);
  log("restock → hidden until the gate is re-evaluated, then listed again");

  // Default ingest re-evaluates immediately: a price rise shows up without a separate recompute call.
  const priced = await ingest({ source: "e2e-price", supplierItems: [supplierA({ cost: 4500, inventory: 3 })] });
  assert.equal(priced.status, 200, JSON.stringify(priced.body));
  assert.equal(priced.body.recompute.sellable, 1);
  const repriced = await opportunities();
  assert.equal(repriced.opportunities.length, 1);
  assert.equal(repriced.opportunities[0].profit.expectedProfit, 9800 - 4500 - 600 - 300 - 980 - 0 - 100);
  log("ingest auto-recomputes: new cost 4500 → profit 3320 listed immediately");

  // 13. Stale inventory (no new observation for 7h) → hidden without any recompute.
  await rest(`supplier_offer_freshness?supplier_offer_id=eq.${top.supplierOfferId}`, { method: "PATCH", body: JSON.stringify({ inventory_observed_at: new Date(Date.now() - 7 * 3600_000).toISOString() }) });
  const stale = await opportunities();
  assert.equal(stale.opportunities.length, 0);
  assert.equal(stale.excluded.INVENTORY_STALE, 1);
  log("inventory observed 7h ago (policy 6h) → hidden with INVENTORY_STALE");

  // 14. A human REJECT is final: recompute never re-links it.
  await ingest({ source: "e2e-stock", supplierItems: [supplierA({ inventory: 3 })] });
  await recompute();
  assert.equal((await opportunities()).opportunities.length, 1);
  const productId = (await rest("supplier_product?select=id&supplier_product_id=eq.NS-1001"))[0].id;
  await rest("identity_match", { method: "POST", body: JSON.stringify({ supplier_product_id: productId, master_product_id: earbuds.id, confidence: 1, decision: "REJECT", hard_block: false }) });
  assert.equal((await opportunities()).opportunities.length, 0);
  const r4 = await recompute();
  assert.equal(r4.identity.written, 0);
  assert.equal((await opportunities()).opportunities.length, 0);
  log("human REJECT hides the offer and is not overridden by recompute");

  // 15. Purchase authorization refuses a REJECTed link (before any Stripe call).
  const purchase = await api("/api/purchase/authorize", { method: "POST", json: { masterProductId: earbuds.id, supplierOfferId: top.supplierOfferId }, token: null });
  assert.equal(purchase.status, 409);
  assert.equal(purchase.body.error, "IDENTITY_LINK_NOT_CONFIRMED");
  log("purchase/authorize → 409 IDENTITY_LINK_NOT_CONFIRMED for a rejected link");

  // 16. DB errors are reported, never answered with success.
  const bad = await ingest({ source: "e2e-bad", marketObservations: [{ masterProductId: "00000000-0000-4000-8000-000000000000", source: "amazon_jp", salePrice: 1000 }] });
  assert.equal(bad.status, 500);
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.errors[0].error, /market_price_observation insert/);
  const runs = await rest("ingestion_run?select=status,error_count&source=eq.e2e-bad");
  assert.equal(runs[0].status, "FAILED");
  log("FK violation → HTTP 500 ok:false, ingestion_run FAILED");

  // 17. Cron entry point (Vercel Cron: GET + Bearer CRON_SECRET).
  const cron = await fetch(APP + "/api/opportunities/recompute", { headers: { authorization: `Bearer ${CRON}` } });
  assert.equal(cron.status, 200);
  log("GET /api/opportunities/recompute with CRON_SECRET → 200");

  // 18. Decision console and quality patrol run on the same live schema.
  const decision = await api("/api/decision", { method: "POST", json: { jan: JAN_EARBUDS, brand: "ACME", modelNumber: "AX-204", color: "BLACK" }, token: null });
  assert.equal(decision.status, 200, JSON.stringify(decision.body));
  assert.equal(decision.body.decision.decision, "AUTO_LINK");
  assert.equal(decision.body.decision.masterProductId, earbuds.id);
  const patrol = await api("/api/quality-patrol", { method: "POST", token: null });
  assert.equal(patrol.status, 200, JSON.stringify(patrol.body));
  assert.equal(patrol.body.status, "PASSED", JSON.stringify(patrol.body.checks.filter((c: any) => c.severity === "ERROR")));
  log("decision API → AUTO_LINK; quality patrol → PASSED (all tables + policies present)");

  // 19. Pages render.
  for (const page of ["/", "/opportunities", "/console", "/quality", "/review"]) {
    const response = await fetch(APP + page);
    assert.equal(response.status, 200, page);
  }
  log("pages /, /opportunities, /console, /quality, /review → 200");

  console.log(`MATCHER E2E: PASS (${step} steps)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

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

const userToken = (email: string, extra: Record<string, unknown> = {}) =>
  "e2e." + Buffer.from(JSON.stringify({ id: "00000000-0000-4000-8000-" + Buffer.from(email).toString("hex").slice(0, 12).padEnd(12, "0"), email, ...extra })).toString("base64url") + ".sig";
const BUYER = userToken("buyer@e2e.test");
const ADMIN = userToken("admin@e2e.test");
const STRANGER = userToken("someone@e2e.test");
async function authorize(token: string | null, payload: unknown) {
  return api("/api/purchase/authorize", { method: "POST", json: payload, token: null, headers: token ? { authorization: `Bearer ${token}` } : {} });
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

  // ---- Purchase security: authenticated purchaser + re-verification on the newest data ----
  const offerA = repriced.opportunities[0];
  const approvedA = { amount: 4500 + 600, expectedProfit: offerA.profit.expectedProfit };
  const target = { masterProductId: offerA.masterProductId, supplierOfferId: offerA.supplierOfferId };
  assert.equal((await authorize(null, { ...target, approved: approvedA })).body.error, "AUTH_REQUIRED");
  assert.equal((await authorize(null, { ...target, approved: approvedA })).status, 401);
  assert.equal((await authorize("not-a-real-token", { ...target, approved: approvedA })).status, 401);
  const stranger = await authorize(STRANGER, { ...target, approved: approvedA });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.error, "PURCHASER_ROLE_REQUIRED");
  assert.equal((await authorize(BUYER, target)).body.error, "APPROVED_TERMS_REQUIRED");
  log("purchase/authorize: no token / invalid token → 401, non-purchaser → 403, missing approved terms → 400");

  const changed = await authorize(BUYER, { ...target, approved: { amount: 4100 + 600 } });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, "PURCHASE_TERMS_CHANGED");
  assert.equal(changed.body.current.amount, 5100);
  const lowerProfit = await authorize(BUYER, { ...target, approved: { amount: 5100, expectedProfit: offerA.profit.expectedProfit + 1 } });
  assert.equal(lowerProfit.status, 409);
  assert.deepEqual(lowerProfit.body.reasons, ["PROFIT_DECREASED"]);
  log("approved amount 4700 vs live 5100 → 409 PURCHASE_TERMS_CHANGED; live profit below approved → 409");

  // An older AUTO_LINK never authorizes a purchase once a newer decision exists.
  await rest("identity_match", { method: "POST", body: JSON.stringify({ supplier_product_id: offerA.supplierProductId, master_product_id: offerA.masterProductId, confidence: 0.99, decision: "BLOCK", hard_block: true }) });
  const superseded = await authorize(BUYER, { ...target, approved: approvedA });
  assert.equal(superseded.status, 409);
  assert.equal(superseded.body.error, "IDENTITY_LINK_NOT_CONFIRMED");
  // A fresh AUTO_LINK row is newer than the last gate evaluation → the gate must be re-run first.
  await rest("identity_match", { method: "POST", body: JSON.stringify({ supplier_product_id: offerA.supplierProductId, master_product_id: offerA.masterProductId, confidence: 1, decision: "AUTO_LINK", hard_block: false }) });
  const gateOutdated = await authorize(BUYER, { ...target, approved: approvedA });
  assert.equal(gateOutdated.status, 409);
  assert.equal(gateOutdated.body.error, "QUALITY_GATE_OUTDATED");
  await recompute();
  log("newer BLOCK supersedes the old AUTO_LINK → 409; re-linked but gate older than the link → 409 QUALITY_GATE_OUTDATED");

  // Stock disappears between the opportunity list and the purchase click.
  await ingest({ source: "e2e-race", recompute: false, supplierItems: [supplierA({ cost: 4500, inventory: 0 })] });
  const soldOut = await authorize(BUYER, { ...target, approved: approvedA });
  assert.equal(soldOut.status, 409);
  assert.equal(soldOut.body.error, "PURCHASE_NOT_SELLABLE");
  assert.ok(soldOut.body.reasons.includes("OUT_OF_STOCK"));
  await ingest({ source: "e2e-race", supplierItems: [supplierA({ cost: 4500, inventory: 3 })] });
  log("inventory 0 observed right before purchase → 409 PURCHASE_NOT_SELLABLE (OUT_OF_STOCK)");

  // Fully re-verified purchase reaches Stripe; without Stripe credentials it fails loudly and is recorded as FAILED.
  const reviewsBefore = await count("purchase_review");
  const paid = await authorize(BUYER, { ...target, approved: approvedA, note: "e2e" });
  assert.equal(paid.status, 500);
  assert.equal(paid.body.error, "STRIPE_SERVER_CONFIG_MISSING");
  const [recorded] = await rest(`purchase_review?select=status,amount,currency,requested_by_email,verified_terms&order=created_at.desc&limit=1`);
  assert.equal(await count("purchase_review"), reviewsBefore + 1);
  assert.equal(recorded.status, "FAILED");
  assert.equal(Number(recorded.amount), 5100);
  assert.equal(recorded.requested_by_email, "buyer@e2e.test");
  assert.equal(recorded.verified_terms.inventory, 3);
  assert.equal(recorded.verified_terms.expectedProfit, offerA.profit.expectedProfit);
  assert.ok(recorded.verified_terms.identityMatchId && recorded.verified_terms.gateResultId && recorded.verified_terms.profitSnapshotId);
  log("valid purchase passes re-verification → Stripe not configured → 500, review FAILED with requester + verified terms");

  // Capture re-verifies again: stock gone after authorization → no capture.
  const [awaiting] = await rest("purchase_review", { method: "POST", body: JSON.stringify({
    master_product_id: offerA.masterProductId, supplier_offer_id: offerA.supplierOfferId, amount: 5100, currency: "jpy", status: "AWAITING_HUMAN",
    stripe_payment_intent_id: "pi_e2e_only", verified_terms: { amount: 5100, expectedProfit: offerA.profit.expectedProfit },
  }) });
  assert.equal((await api("/api/purchase/review", { method: "POST", token: null, json: { reviewId: awaiting.id, action: "approve" } })).status, 401);
  await ingest({ source: "e2e-race", recompute: false, supplierItems: [supplierA({ cost: 4500, inventory: 0 })] });
  const capture = await api("/api/purchase/review", { method: "POST", token: null, headers: { "x-matcher-review-token": process.env.MATCHER_REVIEW_TOKEN! }, json: { reviewId: awaiting.id, action: "approve" } });
  assert.equal(capture.status, 409);
  assert.equal(capture.body.error, "PURCHASE_REVERIFICATION_FAILED");
  assert.equal((await rest(`purchase_review?select=status&id=eq.${awaiting.id}`))[0].status, "AWAITING_HUMAN");
  await ingest({ source: "e2e-race", supplierItems: [supplierA({ cost: 4500, inventory: 3 })] });
  log("capture: review without token → 401; stock gone after authorization → 409, nothing captured");


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
  const purchase = await authorize(BUYER, { masterProductId: earbuds.id, supplierOfferId: top.supplierOfferId, approved: { amount: 5100 } });
  assert.equal(purchase.status, 409);
  assert.equal(purchase.body.error, "IDENTITY_LINK_NOT_CONFIRMED");
  log("purchase/authorize → 409 IDENTITY_LINK_NOT_CONFIRMED for a rejected link");


  // ---- Master products: pattern B (candidate), approval, rejection; pattern C already above ----
  const mastersBefore = await count("master_product");
  const JAN_NEW = gtin13("490000000555");
  const nova = (key: string, id: string, extra: Record<string, unknown> = {}) => ({
    supplierKey: key, supplierName: key.toUpperCase(), supplierProductId: id, productName: "NOVA ポータブル扇風機 NV-10", brand: "NOVA", modelNumber: "NV-10",
    cost: 2000, shippingCost: 500, inventory: 10, orderability: "ORDERABLE", identifiers: [{ type: "JAN", value: JAN_NEW }], ...extra,
  });
  const b1 = await ingest({ source: "e2e-new-product", supplierItems: [nova("netsea", "NS-NOVA")] });
  assert.equal(b1.status, 200, JSON.stringify(b1.body));
  assert.equal(b1.body.recompute.identity.candidatesCreated, 1);
  const [candidate] = await rest(`master_product?select=id,status,approval_status,origin,origin_supplier_product_id&approval_status=eq.CANDIDATE`);
  assert.equal(candidate.status, "INACTIVE");
  assert.equal(candidate.origin, "SUPPLIER_CANDIDATE");
  assert.equal((await rest(`product_identifier?select=normalized_value&master_product_id=eq.${candidate.id}`))[0].normalized_value, JAN_NEW);
  const novaProduct = (await rest("supplier_product?select=id&supplier_product_id=eq.NS-NOVA"))[0];
  const [novaMatch] = await rest(`identity_match?select=decision,master_product_id,hard_block&supplier_product_id=eq.${novaProduct.id}&order=created_at.desc&limit=1`);
  assert.equal(novaMatch.decision, "REVIEW");
  assert.equal(novaMatch.master_product_id, candidate.id);
  assert.equal(candidate.origin_supplier_product_id, novaProduct.id);
  log("pattern B: unknown JAN → CANDIDATE master (INACTIVE) + identity REVIEW, never AUTO_LINK");

  // Same JAN from another supplier joins the candidate; a product with only a name proposes nothing.
  await ingest({ source: "e2e-new-product", supplierItems: [nova("superdelivery", "SD-NOVA"), { supplierKey: "superdelivery", supplierName: "スーパーデリバリー", supplierProductId: "SD-NONAME", productName: "謎の雑貨", cost: 100, shippingCost: 100, inventory: 1, orderability: "ORDERABLE" }] });
  assert.equal(await count("master_product"), mastersBefore + 1);
  const sdNova = (await rest("supplier_product?select=id&supplier_product_id=eq.SD-NOVA"))[0];
  assert.equal((await rest(`identity_match?select=master_product_id&supplier_product_id=eq.${sdNova.id}&order=created_at.desc&limit=1`))[0].master_product_id, candidate.id);
  const noName = (await rest("supplier_product?select=id&supplier_product_id=eq.SD-NONAME"))[0];
  const [noNameMatch] = await rest(`identity_match?select=decision,master_product_id&supplier_product_id=eq.${noName.id}`);
  assert.equal(noNameMatch.decision, "REVIEW");
  assert.equal(noNameMatch.master_product_id, null);
  const rerun = await recompute();
  assert.equal(rerun.identity.candidatesCreated, 0);
  assert.equal(rerun.identity.written, 0);
  log("same JAN elsewhere → linked to the existing candidate (no duplicate); name-only product → nothing created; rerun writes 0");

  // A market price for a candidate is not enough to sell it.
  await ingest({ source: "e2e-new-product", marketObservations: [{ masterProductId: candidate.id, source: "amazon_jp", salePrice: 6000, paymentFee: 180, marketplaceFee: 600, tax: 0, otherCost: 0 }] });
  const pending = await opportunities();
  assert.ok(!pending.opportunities.some((o: any) => o.masterProductId === candidate.id));
  assert.ok(pending.excluded.IDENTITY_REVIEW >= 2);
  log("candidate with a market price is still not an opportunity (identity REVIEW)");

  // Human approval: only reviewers/admins; then identifier evidence (JAN) links both suppliers.
  assert.equal((await api("/api/master-products", { token: null })).status, 401);
  assert.equal((await api("/api/master-products/review", { method: "POST", token: null, headers: { authorization: `Bearer ${BUYER}` }, json: { masterProductId: candidate.id, action: "approve" } })).status, 403);
  const listed = await api("/api/master-products", { token: null, headers: { authorization: `Bearer ${ADMIN}` } });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.masters.some((m: any) => m.id === candidate.id && m.identifiers.length === 1));
  const approve = await api("/api/master-products/review", { method: "POST", token: null, headers: { "x-matcher-review-token": process.env.MATCHER_REVIEW_TOKEN! }, json: { masterProductId: candidate.id, action: "approve" } });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(approve.body.master.status, "ACTIVE");
  const afterApproval = await opportunities();
  const novaOffers = afterApproval.opportunities.filter((o: any) => o.masterProductId === candidate.id);
  assert.equal(novaOffers.length, 2);
  assert.equal(novaOffers[0].profit.expectedProfit, 6000 - 2000 - 500 - 180 - 600);
  assert.ok(novaOffers[0].identity.evidence.some((e: any) => e.kind === "EXACT_IDENTIFIER"));
  log("purchaser cannot approve masters (403); admin lists, reviewer approves → both suppliers AUTO_LINK on JAN → 2 opportunities");

  // Rejected candidates stay rejected and are not proposed again.
  const JAN_REJ = gtin13("490000000666");
  await ingest({ source: "e2e-new-product", supplierItems: [nova("netsea", "NS-REJ", { productName: "怪しい商品", brand: "QQ", modelNumber: "QQ-1", identifiers: [{ type: "JAN", value: JAN_REJ }] })] });
  const [toReject] = await rest(`master_product?select=id&approval_status=eq.CANDIDATE`);
  const rejected = await api("/api/master-products/review", { method: "POST", token: null, headers: { authorization: `Bearer ${ADMIN}` }, json: { masterProductId: toReject.id, action: "reject" } });
  assert.equal(rejected.status, 200);
  const mastersAfterReject = await count("master_product");
  await ingest({ source: "e2e-new-product", supplierItems: [nova("netsea", "NS-REJ", { productName: "怪しい商品", brand: "QQ", modelNumber: "QQ-1", identifiers: [{ type: "JAN", value: JAN_REJ }], cost: 1900 })] });
  assert.equal(await count("master_product"), mastersAfterReject);
  const rejProduct = (await rest("supplier_product?select=id&supplier_product_id=eq.NS-REJ"))[0];
  assert.equal((await rest(`identity_match?select=decision&supplier_product_id=eq.${rejProduct.id}&order=created_at.desc&limit=1`))[0].decision, "REVIEW");
  log("admin rejects a candidate → re-ingest proposes nothing new, identity stays REVIEW");

  // ---- External sources without credentials: explicit 503, nothing written ----
  const runsBefore = await count("ingestion_run");
  assert.equal((await api("/api/sources/import", { method: "POST", token: null, json: { source: "EBAY", query: "x" } })).status, 401);
  const ebayImport = await api("/api/sources/import", { method: "POST", json: { source: "EBAY", query: "ACME AX-204" } });
  assert.equal(ebayImport.status, 503);
  assert.equal(ebayImport.body.error, "EBAY_API_CONFIG_MISSING");
  const kakakuImport = await api("/api/sources/import", { method: "POST", json: { source: "KAKAKU", gtin: JAN_EARBUDS } });
  assert.equal(kakakuImport.status, 503);
  assert.equal(kakakuImport.body.error, "KAKAKU_API_CONFIG_MISSING");
  assert.equal((await api("/api/sources/import", { method: "POST", json: { source: "AMAZON", query: "x" } })).status, 400);
  assert.equal(await count("ingestion_run"), runsBefore);
  log("source import: no token → 401; eBay / 価格.com without credentials → 503, zero rows; unknown source → 400");

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
  assert.equal((await api("/api/quality-patrol", { method: "POST", token: null })).status, 401);
  assert.equal((await api("/api/quality-patrol", { method: "POST", token: null, headers: { authorization: `Bearer ${BUYER}` } })).status, 403);
  const patrol = await api("/api/quality-patrol", { method: "POST" });
  assert.equal(patrol.status, 200, JSON.stringify(patrol.body));
  assert.equal(patrol.body.status, "PASSED", JSON.stringify(patrol.body.checks.filter((c: any) => c.severity === "ERROR")));
  log("decision API → AUTO_LINK; quality patrol: no auth 401, purchaser 403, ops token → PASSED");

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

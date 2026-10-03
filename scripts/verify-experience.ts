import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const files = {
  home: readFileSync("app/page.tsx", "utf8"),
  console: readFileSync("app/console/page.tsx", "utf8"),
  quality: readFileSync("app/quality/page.tsx", "utf8"),
  decision: readFileSync("app/api/decision/route.ts", "utf8"),
  patrol: readFileSync("app/api/quality-patrol/route.ts", "utf8"),
  identity: readFileSync("lib/matcher/identity.ts", "utf8"),
  gate: readFileSync("lib/matcher/gate.ts", "utf8"),
  purchaseAuthorize: readFileSync("app/api/purchase/authorize/route.ts", "utf8"),
  purchaseReview: readFileSync("app/api/purchase/review/route.ts", "utf8"),
  purchasePending: readFileSync("app/api/purchase/pending/route.ts", "utf8"),
  purchaseReviewPage: readFileSync("app/review/page.tsx", "utf8"),
  opportunities: readFileSync("app/opportunities/page.tsx", "utf8"),
  opportunityApi: readFileSync("app/api/opportunities/route.ts", "utf8"),
  stripeWebhook: readFileSync("app/api/stripe/webhook/route.ts", "utf8"),
  stripe: readFileSync("lib/server/stripe.ts", "utf8"),
};

const required = [
  ["home customer journey", files.home, "CHECK"],
  ["home decision CTA", files.home, "/console"],
  ["profit opportunity CTA", files.home, "/opportunities"],
  ["profit opportunity feed", files.opportunities, "VERIFIED OPPORTUNITIES"],
  ["opportunity server feed", files.opportunityApi, "profit_snapshot"],
  ["opportunity sellability gate", files.opportunityApi, "SELLABLE"],
  ["quality center", files.home, "/quality"],
  ["customer value proposition", files.home, "WHY MATCHER"],
  ["loss prevention promise", files.home, "仕入れて後悔しない"],
  ["decision outcome clarity", files.console, "同一商品か"],
  ["decision API", files.decision, "matchIdentity"],
  ["supplier offer binding", files.decision, "supplier_offer"],
  ["freshness gate", files.decision, "supplier_offer_freshness"],
  ["quality patrol", files.patrol, "quality_patrol_run"],
  ["quality diagnosis", files.patrol, "quality_diagnosis"],
  ["quality stages", files.quality, "RETEST"],
  ["identity hard conflict", files.identity, "ATTRIBUTE_CONFLICT"],
  ["profit gate", files.gate, "expectedProfit"],
  ["human purchase gate", files.console, "カードを仮押さえして人間確認へ"],
  ["manual capture", files.stripe, "payment_intent_data[capture_method]"],
  ["server purchase amount", files.purchaseAuthorize, "supplier_cost"],
  ["review authorization", files.purchaseReview, "REVIEW_AUTH_REQUIRED"],
  ["review queue authorization", files.purchasePending, "REVIEW_AUTH_REQUIRED"],
  ["human review UI", files.purchaseReviewPage, "承認して決済確定"],
  ["purchase rejection UI", files.purchaseReviewPage, "却下してカード取消"],
  ["stripe webhook verification", files.stripeWebhook, "STRIPE_SIGNATURE_INVALID"],
  ["stripe webhook reconciliation", files.stripeWebhook, "payment_intent.succeeded"],
  ["AI integrity disclosure", files.home, "推測だけで一致を確定しない"],
];
for (const [name, source, needle] of required) assert.ok(source.includes(needle), `${name}: missing ${needle}`);
for (const [name, source] of Object.entries(files)) assert.equal(source.includes("\\n"), false, `${name}: escaped newline artifact`);
console.log(`MATCHER experience quality checks: PASS (${required.length} checks)`);
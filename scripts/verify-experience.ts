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
};

const required = [
  ["home customer journey", files.home, "CHECK"],
  ["home decision CTA", files.home, "/console"],
  ["quality center", files.home, "/quality"],
  ["decision API", files.decision, "matchIdentity"],
  ["supplier offer binding", files.decision, "supplier_offer"],
  ["freshness gate", files.decision, "supplier_offer_freshness"],
  ["quality patrol", files.patrol, "quality_patrol_run"],
  ["quality diagnosis", files.patrol, "quality_diagnosis"],
  ["quality stages", files.quality, "RETEST"],
  ["identity hard conflict", files.identity, "ATTRIBUTE_CONFLICT"],
  ["profit gate", files.gate, "expectedProfit"],
  ["human purchase gate", files.console, "カードを仮押さえして人間確認へ"],
  ["manual capture", files.purchaseAuthorize, "capture_method"],
  ["server purchase amount", files.purchaseAuthorize, "supplier_cost"],
  ["review authorization", files.purchaseReview, "REVIEW_AUTH_REQUIRED"],
  ["review queue authorization", files.purchasePending, "REVIEW_AUTH_REQUIRED"],
];
for (const [name, source, needle] of required) assert.ok(source.includes(needle), `${name}: missing ${needle}`);
for (const [name, source] of Object.entries(files)) assert.equal(source.includes("\\n"), false, `${name}: escaped newline artifact`);
console.log(`MATCHER experience quality checks: PASS (${required.length} checks)`);
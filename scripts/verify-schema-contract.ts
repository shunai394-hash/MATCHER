import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const migration = ["20261011020000_ingestion_schema_contract.sql", "20261011030000_identity_evidence_contract.sql", "20261011040000_market_profit_contract.sql", "20261011050000_profit_snapshot_upsert_index.sql"]
  .map((file) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"))
  .join("\n");
const runtimeTables = [
  "supplier",
  "supplier_product",
  "supplier_product_identifier",
  "supplier_offer",
  "supplier_offer_snapshot",
  "supplier_offer_freshness",
  "identity_match",
  "market_observation",
  "profit_snapshot",
  "profit_fee_policy",
];
for (const table of runtimeTables) {
  if (!new RegExp(`create table(?: if not exists)? ${table}\\s*\\(`, "i").test(schema)) {
    throw new Error(`db/schema.sql is missing runtime table: ${table}`);
  }
  if (!new RegExp(`create table if not exists public\\.${table}\\s*\\(`, "i").test(migration)) {
    throw new Error(`Supabase migration is missing runtime table: ${table}`);
  }
}
const requiredColumns: Record<string, string[]> = {
  supplier_product: ["product_name", "supplier_id", "supplier_product_id", "source_url", "image_url", "first_seen_at", "last_seen_at"],
  supplier_offer: ["supplier_product_id", "currency", "orderability", "observed_at"],
  supplier_product_identifier: ["supplier_product_id", "identifier_type", "identifier_value"],
  supplier_offer_snapshot: ["supplier_offer_id", "supplier_cost", "shipping_cost", "inventory", "observed_at"],
  supplier_offer_freshness: ["supplier_offer_id", "price_observed_at", "inventory_observed_at", "shipping_observed_at"],
  identity_match: ["supplier_product_id", "master_product_id", "confidence", "decision", "hard_block", "hard_block_reasons", "evidence"],
  market_observation: ["master_product_id", "source", "sales_count", "active_listing_count", "median_sale_price", "observed_at", "evidence_url"],
  profit_snapshot: ["supplier_offer_id", "market_observation_id", "sale_price", "supplier_cost", "shipping_cost", "payment_fee", "marketplace_fee", "tax", "expected_profit"],
  profit_fee_policy: ["marketplace", "marketplace_fee_rate", "payment_fee_rate", "fixed_fee", "tax_rate", "evidence_url", "active"],
};
for (const [table, columns] of Object.entries(requiredColumns)) {
  const block = schema.match(new RegExp(`create table ${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"))?.[1];
  if (!block) throw new Error(`Cannot parse schema block for ${table}`);
  for (const column of columns) {
    if (!new RegExp(`^\\s*${column}\\s`, "im").test(block)) {
      throw new Error(`db/schema.sql is missing ${table}.${column}`);
    }
  }
}
console.log("verify:schema-contract PASS");

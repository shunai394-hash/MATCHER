-- Rollback of 009 (no data loss: drops only the unique index).
-- psql "$PROD_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f db/ops/rollback/009_rollback.sql
drop index if exists idx_supplier_offer_product_currency;

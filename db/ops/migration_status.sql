-- MATCHER migration status (READ ONLY): which effects of db/migrations/006-009 are present.
--   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f db/ops/migration_status.sql
-- A migration counts as applied only when every one of its markers is true.
begin transaction read only;
with col(t, c) as (select table_name, column_name from information_schema.columns where table_schema = 'public'),
markers(migration, marker, ok) as (values
  ('006', 'identity_match table',                     to_regclass('public.identity_match') is not null),
  ('006', 'match_result renamed or absent',           to_regclass('public.match_result') is null),
  ('006', 'supplier_offer_snapshot table',            to_regclass('public.supplier_offer_snapshot') is not null),
  ('006', 'supplier_product.product_name',            exists (select 1 from col where t = 'supplier_product' and c = 'product_name')),
  ('006', 'supplier_product.first_seen_at/last_seen_at', (select count(*) = 2 from col where t = 'supplier_product' and c in ('first_seen_at','last_seen_at'))),
  ('006', 'no legacy supplier_product columns',       not exists (select 1 from col where t = 'supplier_product' and c in ('title','fetched_at','source_updated_at'))),
  ('006', 'no legacy supplier_offer price/stock',     not exists (select 1 from col where t = 'supplier_offer' and c in ('cost','shipping_cost','inventory','shipping_verified','observed_at'))),
  ('006', 'supplier_offer.updated_at',                exists (select 1 from col where t = 'supplier_offer' and c = 'updated_at')),
  ('006', 'supplier_offer_freshness.updated_at',      exists (select 1 from col where t = 'supplier_offer_freshness' and c = 'updated_at')),
  ('006', 'identity_match.hard_block',                exists (select 1 from col where t = 'identity_match' and c = 'hard_block')),
  ('006', 'identity_match hard-block guard trigger',  exists (select 1 from pg_trigger where tgname = 'identity_match_hard_block_guard')),
  ('006', 'quality_patrol_run + quality_diagnosis',   to_regclass('public.quality_patrol_run') is not null and to_regclass('public.quality_diagnosis') is not null),
  ('006', 'supplier_product_set_count_check',         exists (select 1 from pg_constraint where conname = 'supplier_product_set_count_check')),
  ('007', 'master_product approval columns',          (select count(*) = 5 from col where t = 'master_product' and c in ('approval_status','origin','origin_supplier_product_id','reviewed_at','reviewed_by'))),
  ('007', 'master_product constraints',               (select count(*) = 3 from pg_constraint where conname in ('master_product_approval_status_check','master_product_origin_check','master_product_active_requires_approval'))),
  ('007', 'idx_master_product_origin_supplier_product', to_regclass('public.idx_master_product_origin_supplier_product') is not null),
  ('008', 'purchase_review requester/terms columns',  (select count(*) = 3 from col where t = 'purchase_review' and c in ('requested_by_user_id','requested_by_email','verified_terms'))),
  ('009', 'idx_supplier_offer_product_currency',      to_regclass('public.idx_supplier_offer_product_currency') is not null)
)
select migration, bool_and(ok) as applied, count(*) filter (where not ok) as missing_markers,
       string_agg(marker, '; ') filter (where not ok) as missing
from markers group by migration order by migration;
rollback;

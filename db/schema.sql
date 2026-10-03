-- MATCHER schema, aligned with the live Supabase project (ref bihnncycujxifczvhfhr).
--
-- Column lists for supplier_product, supplier_offer, supplier_offer_snapshot,
-- supplier_offer_freshness and identity_match mirror the live database as
-- confirmed by the project owner (2026-10). There is NO match_result table and
-- supplier_offer carries no price/inventory columns: prices, shipping and
-- inventory live in append-only supplier_offer_snapshot rows.
--
-- Used by CI and scripts/e2e to run the application against a real Postgres +
-- PostgREST stack. Apply with: psql -v ON_ERROR_STOP=1 -f db/schema.sql

create extension if not exists pgcrypto;

create type product_status as enum ('ACTIVE', 'INACTIVE');
create type orderability_status as enum ('ORDERABLE', 'OUT_OF_STOCK', 'UNKNOWN', 'BLOCKED');
create type identity_decision as enum ('AUTO_LINK', 'REVIEW', 'BLOCK', 'REJECT');
create type sellability_status as enum ('SELLABLE', 'BLOCKED');
create type quality_run_state as enum ('DETECTED', 'DIAGNOSED', 'REPAIRED', 'TESTED', 'RETESTED', 'RESOLVED');
create type media_type as enum ('IMAGE', 'SPECIFICATION');

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

/* ---------- canonical product ---------- */

create table master_product (
  id uuid primary key default gen_random_uuid(),
  brand text,
  product_name text not null,
  manufacturer text,
  model_number text,
  status product_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table product_identifier (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references master_product(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('JAN','EAN','UPC','MPN','SKU','SUPPLIER_PRODUCT_NO')),
  identifier_value text not null,
  normalized_value text not null,
  source text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index idx_product_identifier_product_scoped on product_identifier(master_product_id, identifier_type, normalized_value);
create unique index idx_product_identifier_global_gtin on product_identifier(identifier_type, normalized_value) where identifier_type in ('JAN','EAN','UPC');
create index idx_identifier_lookup on product_identifier(identifier_type, normalized_value);

create table product_variant (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references master_product(id) on delete cascade,
  variant_key text not null,
  color text,
  size text,
  capacity text,
  generation text,
  set_count integer check (set_count is null or set_count > 0),
  condition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (master_product_id, variant_key)
);
create index idx_variant_master on product_variant(master_product_id);

create table product_media (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references master_product(id) on delete cascade,
  product_variant_id uuid references product_variant(id) on delete cascade,
  media_type media_type not null,
  media_url text not null,
  source text,
  created_at timestamptz not null default now()
);

/* ---------- supplier side ---------- */

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_key text not null unique,
  name text not null,
  status product_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table supplier_product (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  supplier_product_id text not null,
  supplier_sku text,
  brand text,
  product_name text,
  manufacturer text,
  model_number text,
  color text,
  size text,
  capacity text,
  generation text,
  set_count integer check (set_count is null or set_count > 0),
  condition text,
  source_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (supplier_id, supplier_product_id)
);
create index idx_supplier_product_last_seen on supplier_product(last_seen_at desc);

create table supplier_product_identifier (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references supplier_product(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('JAN','EAN','UPC','MPN','SKU','SUPPLIER_PRODUCT_NO')),
  identifier_value text not null,
  normalized_value text not null,
  source text,
  created_at timestamptz not null default now(),
  unique (supplier_product_id, identifier_type, normalized_value)
);
create index idx_supplier_product_identifier_lookup on supplier_product_identifier(identifier_type, normalized_value);

create table supplier_offer (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references supplier_product(id) on delete cascade,
  currency text not null default 'JPY',
  orderability orderability_status not null default 'UNKNOWN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_supplier_offer_product on supplier_offer(supplier_product_id);

create table supplier_offer_snapshot (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  supplier_cost numeric(14,2) check (supplier_cost is null or supplier_cost >= 0),
  shipping_cost numeric(14,2) check (shipping_cost is null or shipping_cost >= 0),
  inventory integer check (inventory is null or inventory >= 0),
  shipping_confidence numeric(5,4) check (shipping_confidence is null or (shipping_confidence >= 0 and shipping_confidence <= 1)),
  observed_at timestamptz not null default now()
);
create index idx_supplier_offer_snapshot_offer on supplier_offer_snapshot(supplier_offer_id, observed_at desc);

create table supplier_offer_freshness (
  supplier_offer_id uuid primary key references supplier_offer(id) on delete cascade,
  price_observed_at timestamptz,
  inventory_observed_at timestamptz,
  shipping_observed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table freshness_policy (
  data_type text primary key check (data_type in ('PRICE','INVENTORY','SHIPPING','MARKET')),
  max_age_seconds integer not null check (max_age_seconds > 0),
  updated_at timestamptz not null default now()
);
insert into freshness_policy(data_type, max_age_seconds) values
  ('PRICE', 86400),
  ('INVENTORY', 21600),
  ('SHIPPING', 604800);

/* ---------- identity ---------- */

create table identity_match (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references supplier_product(id) on delete cascade,
  master_product_id uuid references master_product(id) on delete set null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  decision identity_decision not null,
  hard_block boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_identity_match_supplier_product on identity_match(supplier_product_id, created_at desc);
create index idx_identity_match_master on identity_match(master_product_id, created_at desc);

create or replace function prevent_auto_link_hard_block()
returns trigger
language plpgsql
as $$
begin
  if new.hard_block and new.decision = 'AUTO_LINK' then
    raise exception 'AUTO_LINK is forbidden when hard_block=true';
  end if;
  return new;
end;
$$;
create trigger identity_match_hard_block_guard
before insert or update on identity_match
for each row execute function prevent_auto_link_hard_block();

/* ---------- market, profit, gate ---------- */

create table market_price_observation (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references master_product(id) on delete cascade,
  product_variant_id uuid references product_variant(id) on delete set null,
  source text not null,
  source_product_id text,
  sale_price numeric(14,2) not null check (sale_price >= 0),
  payment_fee numeric(14,2),
  marketplace_fee numeric(14,2),
  tax numeric(14,2),
  other_cost numeric(14,2),
  sold boolean not null default false,
  source_url text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_market_price_master_observed on market_price_observation(master_product_id, observed_at desc);

create table profit_snapshot (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  sale_price numeric(14,2) not null check (sale_price >= 0),
  supplier_cost numeric(14,2),
  shipping_cost numeric(14,2),
  payment_fee numeric(14,2),
  marketplace_fee numeric(14,2),
  tax numeric(14,2),
  other_cost numeric(14,2),
  expected_profit numeric(14,2),
  calculated_at timestamptz not null default now(),
  cost_complete boolean not null default false
);
create index idx_profit_offer on profit_snapshot(supplier_offer_id, calculated_at desc);

create table quality_gate_result (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  status sellability_status not null,
  checks jsonb not null default '{}'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now()
);
create index idx_gate_offer on quality_gate_result(supplier_offer_id, evaluated_at desc);
create index idx_gate_evaluated on quality_gate_result(evaluated_at desc);

/* ---------- operations ---------- */

create table ingestion_run (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null check (status in ('RUNNING','SUCCEEDED','FAILED','PARTIAL')),
  item_count integer not null default 0 check (item_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table quality_run (
  id uuid primary key default gen_random_uuid(),
  state quality_run_state not null,
  target_type text not null,
  target_id uuid,
  root_cause jsonb not null default '{}'::jsonb,
  repair_action jsonb not null default '{}'::jsonb,
  test_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table quality_patrol_run (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('RUNNING','PASSED','FAILED')),
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table quality_diagnosis (
  id uuid primary key default gen_random_uuid(),
  patrol_run_id uuid not null references quality_patrol_run(id) on delete cascade,
  severity text not null check (severity in ('INFO','WARN','ERROR')),
  code text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table purchase_review (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid null references master_product(id),
  supplier_offer_id uuid null references supplier_offer(id),
  amount bigint not null check (amount > 0),
  currency text not null default 'jpy',
  status text not null check (status in ('AUTHORIZING','AWAITING_HUMAN','APPROVED','REJECTED','EXPIRED','FAILED')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  decision_snapshot jsonb not null default '{}'::jsonb,
  rejection_reason text,
  authorized_at timestamptz,
  reviewed_at timestamptz,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index purchase_review_status_idx on purchase_review(status, created_at desc);

create trigger master_product_updated_at before update on master_product for each row execute function set_updated_at();
create trigger product_variant_updated_at before update on product_variant for each row execute function set_updated_at();
create trigger suppliers_updated_at before update on suppliers for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array[
    'master_product','product_identifier','product_variant','product_media','suppliers','supplier_product',
    'supplier_product_identifier','supplier_offer','supplier_offer_snapshot','supplier_offer_freshness','freshness_policy',
    'identity_match','market_price_observation','profit_snapshot','quality_gate_result','ingestion_run','quality_run',
    'quality_patrol_run','quality_diagnosis','purchase_review'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
-- No anon/authenticated policies: MATCHER is server-side only (service role).

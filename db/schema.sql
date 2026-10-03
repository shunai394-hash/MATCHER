create extension if not exists pgcrypto;

create type product_status as enum ('ACTIVE', 'INACTIVE');
create type orderability_status as enum ('ORDERABLE', 'OUT_OF_STOCK', 'UNKNOWN', 'BLOCKED');
create type identity_decision as enum ('AUTO_LINK', 'REVIEW', 'BLOCK', 'REJECT');
create type match_decision as enum ('AUTO_LINK', 'REVIEW', 'REJECT');
create type sellability_status as enum ('SELLABLE', 'BLOCKED');
create type quality_run_state as enum ('DETECTED', 'DIAGNOSED', 'REPAIRED', 'TESTED', 'RETESTED', 'RESOLVED');
create type media_type as enum ('IMAGE', 'SPECIFICATION');

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
  created_at timestamptz not null default now(),
  unique (master_product_id, identifier_type, normalized_value)
);

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

create table product_media (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references master_product(id) on delete cascade,
  product_variant_id uuid references product_variant(id) on delete cascade,
  media_type media_type not null,
  media_url text not null,
  source text,
  created_at timestamptz not null default now()
);

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
  title text,
  brand text,
  model_number text,
  source_url text,
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, supplier_product_id)
);

create table supplier_offer (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references supplier_product(id) on delete cascade,
  product_variant_id uuid references product_variant(id) on delete set null,
  cost numeric(14,2) check (cost is null or cost >= 0),
  shipping_cost numeric(14,2) check (shipping_cost is null or shipping_cost >= 0),
  currency char(3) not null default 'JPY',
  inventory integer check (inventory is null or inventory >= 0),
  orderability orderability_status not null default 'UNKNOWN',
  observed_at timestamptz not null default now(),
  price_age_seconds integer check (price_age_seconds is null or price_age_seconds >= 0),
  inventory_age_seconds integer check (inventory_age_seconds is null or inventory_age_seconds >= 0),
  shipping_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table match_result (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references supplier_product(id) on delete cascade,
  master_product_id uuid references master_product(id) on delete set null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  decision identity_decision not null,
  hard_block_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table match_evidence (
  id uuid primary key default gen_random_uuid(),
  match_result_id uuid not null references match_result(id) on delete cascade,
  field_name text not null,
  comparison text not null,
  source_value text,
  master_value text,
  weight numeric(6,4),
  created_at timestamptz not null default now()
);

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

create table quality_gate_result (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  status sellability_status not null,
  checks jsonb not null default '{}'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now()
);

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

create index idx_identifier_lookup on product_identifier(identifier_type, normalized_value);

-- GTIN-family identifiers are globally unique. SKU/MPN/supplier identifiers
-- are scoped to their owning product/context instead of being globally unique.
create unique index idx_product_identifier_global_gtin
  on product_identifier(identifier_type, normalized_value)
  where identifier_type in ('JAN', 'EAN', 'UPC');
create index idx_variant_master on product_variant(master_product_id);
create index idx_supplier_product_supplier on supplier_product(supplier_id);
create index idx_supplier_offer_product on supplier_offer(supplier_product_id);
create index idx_supplier_offer_observed on supplier_offer(observed_at desc);
create index idx_match_supplier_product on match_result(supplier_product_id, created_at desc);
create index idx_match_master on match_result(master_product_id, created_at desc);
create index idx_evidence_match on match_evidence(match_result_id);
create index idx_profit_offer on profit_snapshot(supplier_offer_id, calculated_at desc);
create index idx_gate_offer on quality_gate_result(supplier_offer_id, evaluated_at desc);
create index idx_quality_run_target on quality_run(target_type, target_id, created_at desc);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger master_product_updated_at before update on master_product
for each row execute function set_updated_at();
create trigger product_variant_updated_at before update on product_variant
for each row execute function set_updated_at();
create trigger suppliers_updated_at before update on suppliers
for each row execute function set_updated_at();
create trigger supplier_product_updated_at before update on supplier_product
for each row execute function set_updated_at();

alter table master_product enable row level security;
alter table product_identifier enable row level security;
alter table product_variant enable row level security;
alter table product_media enable row level security;
alter table suppliers enable row level security;
alter table supplier_product enable row level security;
alter table supplier_offer enable row level security;
alter table match_result enable row level security;
alter table match_evidence enable row level security;
alter table profit_snapshot enable row level security;
alter table quality_gate_result enable row level security;
alter table ingestion_run enable row level security;
alter table quality_run enable row level security;

-- No anon/authenticated policies are created here. MATCHER's first release is
-- server-side/internal; public access must be added explicitly per API contract.

create extension if not exists pgcrypto;

do $$ begin
  create type product_status as enum ('ACTIVE','INACTIVE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type orderability_status as enum ('ORDERABLE','OUT_OF_STOCK','UNKNOWN','BLOCKED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type match_decision as enum ('AUTO_LINK','REVIEW','REJECT','BLOCK');
exception when duplicate_object then null; end $$;
do $$ begin
  create type sellability_status as enum ('SELLABLE','BLOCKED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type patrol_status as enum ('RUNNING','PASSED','FAILED','REPAIRED');
exception when duplicate_object then null; end $$;

create table if not exists master_product (
  id uuid primary key default gen_random_uuid(),
  brand text,
  product_name text not null,
  manufacturer text,
  model_number text,
  status product_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_identifier (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references master_product(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('JAN','EAN','UPC','MPN','SKU')),
  identifier_value text not null,
  source text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (identifier_type, identifier_value)
);

create table if not exists product_variant (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references master_product(id) on delete cascade,
  color text,
  size text,
  capacity text,
  generation text,
  set_count integer check (set_count is null or set_count > 0),
  condition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_media (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references master_product(id) on delete cascade,
  product_variant_id uuid references product_variant(id) on delete cascade,
  media_type text not null check (media_type in ('IMAGE','SPECIFICATION')),
  media_url text not null,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists supplier (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists supplier_product (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references supplier(id) on delete cascade,
  supplier_product_id text not null,
  supplier_sku text,
  brand text,
  product_name text not null,
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

create table if not exists supplier_product_identifier (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references supplier_product(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('JAN','EAN','UPC','MPN','SKU')),
  identifier_value text not null,
  created_at timestamptz not null default now(),
  unique (supplier_product_id, identifier_type, identifier_value)
);

create table if not exists supplier_offer (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references supplier_product(id) on delete cascade,
  currency char(3) not null default 'JPY',
  orderability orderability_status not null default 'UNKNOWN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_product_id)
);

create table if not exists supplier_offer_snapshot (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  supplier_cost numeric(14,2),
  shipping_cost numeric(14,2),
  inventory integer,
  shipping_confidence numeric(5,4) check (shipping_confidence is null or shipping_confidence between 0 and 1),
  observed_at timestamptz not null default now()
);

create table if not exists identity_match (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references supplier_product(id) on delete cascade,
  master_product_id uuid not null references master_product(id) on delete cascade,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  decision match_decision not null,
  hard_block boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists identity_match_evidence (
  id uuid primary key default gen_random_uuid(),
  identity_match_id uuid not null references identity_match(id) on delete cascade,
  field_name text not null,
  master_value text,
  supplier_value text,
  result text not null check (result in ('EXACT','MISMATCH','UNKNOWN','COMPATIBLE')),
  critical boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists identity_hard_block (
  id uuid primary key default gen_random_uuid(),
  identity_match_id uuid not null references identity_match(id) on delete cascade,
  reason_code text not null check (reason_code in (
    'MPN_MISMATCH','SET_COUNT_MISMATCH','COLOR_MISMATCH',
    'SIZE_MISMATCH','CONDITION_MISMATCH','VARIANT_MISMATCH'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (identity_match_id, reason_code)
);

create table if not exists freshness_policy (
  id uuid primary key default gen_random_uuid(),
  data_type text not null unique check (data_type in ('PRICE','INVENTORY','SHIPPING')),
  max_age_seconds integer not null check (max_age_seconds > 0),
  updated_at timestamptz not null default now()
);

insert into freshness_policy(data_type,max_age_seconds) values
 ('PRICE',86400),('INVENTORY',21600),('SHIPPING',604800)
on conflict (data_type) do nothing;

create table if not exists profit_snapshot (
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
  calculated_at timestamptz not null default now()
);

create table if not exists quality_patrol_run (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status patrol_status not null default 'RUNNING',
  summary jsonb not null default '{}'::jsonb
);

create table if not exists quality_diagnosis (
  id uuid primary key default gen_random_uuid(),
  patrol_run_id uuid not null references quality_patrol_run(id) on delete cascade,
  supplier_offer_id uuid references supplier_offer(id) on delete cascade,
  severity text not null,
  code text not null,
  details jsonb not null default '{}'::jsonb,
  diagnosed_at timestamptz not null default now()
);

create table if not exists quality_repair (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references quality_diagnosis(id) on delete cascade,
  action text not null,
  result text not null,
  details jsonb not null default '{}'::jsonb,
  repaired_at timestamptz not null default now()
);

create table if not exists quality_retest (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references quality_diagnosis(id) on delete cascade,
  passed boolean not null,
  details jsonb not null default '{}'::jsonb,
  tested_at timestamptz not null default now()
);

create table if not exists quality_gate_result (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  status sellability_status not null,
  checks jsonb not null default '{}'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now()
);

create index if not exists idx_identifier_master on product_identifier(master_product_id);
create index if not exists idx_variant_master on product_variant(master_product_id);
create index if not exists idx_supplier_product_supplier on supplier_product(supplier_id);
create index if not exists idx_supplier_product_identifier on supplier_product_identifier(identifier_value);
create index if not exists idx_offer_product on supplier_offer(supplier_product_id);
create index if not exists idx_offer_snapshot_offer_time on supplier_offer_snapshot(supplier_offer_id, observed_at desc);
create index if not exists idx_identity_supplier_product on identity_match(supplier_product_id);
create index if not exists idx_identity_master on identity_match(master_product_id);
create index if not exists idx_identity_block_match on identity_hard_block(identity_match_id);
create index if not exists idx_patrol_diagnosis_run on quality_diagnosis(patrol_run_id);
create index if not exists idx_quality_gate_offer on quality_gate_result(supplier_offer_id);


create table if not exists supplier_offer_freshness (
  supplier_offer_id uuid primary key references supplier_offer(id) on delete cascade,
  price_observed_at timestamptz,
  inventory_observed_at timestamptz,
  shipping_observed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists supplier_offer_observation (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  observation_type text not null check (observation_type in ('PRICE','INVENTORY','SHIPPING')),
  price numeric(14,2),
  inventory integer,
  shipping_cost numeric(14,2),
  observed_at timestamptz not null default now()
);

create index if not exists idx_offer_observation_type_time
  on supplier_offer_observation(supplier_offer_id, observation_type, observed_at desc);

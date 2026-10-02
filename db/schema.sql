create extension if not exists pgcrypto;

create type product_status as enum ('ACTIVE', 'INACTIVE');
create type orderability_status as enum ('ORDERABLE', 'OUT_OF_STOCK', 'UNKNOWN', 'BLOCKED');
create type match_decision as enum ('AUTO_LINK', 'REVIEW', 'REJECT');
create type sellability_status as enum ('SELLABLE', 'BLOCKED');

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
  identifier_type text not null check (
    identifier_type in ('JAN','EAN','UPC','MPN','SKU','SUPPLIER_PRODUCT_NO')
  ),
  identifier_value text not null,
  source text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (identifier_type, identifier_value)
);

create table product_variant (
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

create table product_media (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references master_product(id) on delete cascade,
  product_variant_id uuid references product_variant(id) on delete cascade,
  media_type text not null check (media_type in ('IMAGE','SPECIFICATION')),
  media_url text not null,
  source text,
  created_at timestamptz not null default now()
);

create table supplier_offer (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid references master_product(id) on delete set null,
  supplier text not null,
  supplier_product_id text not null,
  supplier_sku text,
  cost numeric(14,2),
  shipping_cost numeric(14,2),
  inventory integer,
  currency char(3) not null default 'JPY',
  orderability orderability_status not null default 'UNKNOWN',
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier, supplier_product_id)
);

create table match_result (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  master_product_id uuid references master_product(id) on delete set null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  evidence jsonb not null default '{}'::jsonb,
  decision match_decision not null,
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
  calculated_at timestamptz not null default now()
);

create table quality_gate_result (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  status sellability_status not null,
  checks jsonb not null default '{}'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now()
);

create index idx_product_identifier_master on product_identifier(master_product_id);
create index idx_product_variant_master on product_variant(master_product_id);
create index idx_supplier_offer_master on supplier_offer(master_product_id);
create index idx_supplier_offer_supplier on supplier_offer(supplier);
create index idx_match_result_offer on match_result(supplier_offer_id);
create index idx_quality_gate_offer on quality_gate_result(supplier_offer_id);

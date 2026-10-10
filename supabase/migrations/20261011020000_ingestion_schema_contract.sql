create extension if not exists pgcrypto;

do $$ begin
  create type public.product_status as enum ('ACTIVE', 'INACTIVE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.orderability_status as enum ('ORDERABLE', 'OUT_OF_STOCK', 'UNKNOWN', 'BLOCKED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.identity_decision as enum ('AUTO_LINK', 'REVIEW', 'BLOCK', 'REJECT');
exception when duplicate_object then null; end $$;

create table if not exists public.supplier (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.master_product (
  id uuid primary key default gen_random_uuid(),
  brand text,
  product_name text not null,
  manufacturer text,
  model_number text,
  status public.product_status not null default 'ACTIVE',
  approval_status text,
  origin text,
  origin_supplier_product_id uuid,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_product (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.supplier(id) on delete cascade,
  supplier_product_id text not null,
  supplier_sku text,
  product_name text,
  title text,
  brand text,
  manufacturer text,
  model_number text,
  color text,
  size text,
  capacity text,
  generation text,
  set_count integer check (set_count is null or set_count > 0),
  condition text,
  source_url text,
  image_url text,
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.supplier_product add column if not exists product_name text;
alter table public.supplier_product add column if not exists manufacturer text;
alter table public.supplier_product add column if not exists color text;
alter table public.supplier_product add column if not exists size text;
alter table public.supplier_product add column if not exists capacity text;
alter table public.supplier_product add column if not exists generation text;
alter table public.supplier_product add column if not exists set_count integer;
alter table public.supplier_product add column if not exists condition text;
alter table public.supplier_product add column if not exists image_url text;
alter table public.supplier_product add column if not exists first_seen_at timestamptz not null default now();
alter table public.supplier_product add column if not exists last_seen_at timestamptz not null default now();

create table if not exists public.supplier_product_identifier (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references public.supplier_product(id) on delete cascade,
  identifier_type text not null,
  identifier_value text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_offer (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references public.supplier_product(id) on delete cascade,
  currency char(3) not null default 'JPY',
  orderability public.orderability_status not null default 'UNKNOWN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_offer_snapshot (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references public.supplier_offer(id) on delete cascade,
  supplier_cost numeric(14,2) check (supplier_cost is null or supplier_cost >= 0),
  shipping_cost numeric(14,2) check (shipping_cost is null or shipping_cost >= 0),
  inventory integer check (inventory is null or inventory >= 0),
  shipping_confidence numeric(5,4),
  observed_at timestamptz not null default now()
);

create table if not exists public.supplier_offer_freshness (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references public.supplier_offer(id) on delete cascade,
  price_observed_at timestamptz,
  inventory_observed_at timestamptz,
  shipping_observed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.product_identifier (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references public.master_product(id) on delete cascade,
  identifier_type text not null,
  identifier_value text not null,
  normalized_value text,
  source text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.product_identifier add column if not exists normalized_value text;
update public.product_identifier
set normalized_value = upper(regexp_replace(identifier_value, '[[:space:]-]', '', 'g'))
where normalized_value is null and identifier_value is not null;

create table if not exists public.product_variant (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references public.master_product(id) on delete cascade,
  color text,
  size text,
  capacity text,
  generation text,
  set_count integer check (set_count is null or set_count > 0),
  condition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.identity_match (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references public.supplier_product(id) on delete cascade,
  master_product_id uuid references public.master_product(id) on delete set null,
  confidence numeric(5,4) not null default 0 check (confidence >= 0 and confidence <= 1),
  decision public.identity_decision not null default 'REVIEW',
  hard_block boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.market_observation (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references public.master_product(id) on delete cascade,
  source text not null,
  window_start timestamptz,
  window_end timestamptz,
  sales_count integer,
  active_listing_count integer,
  median_sale_price numeric(14,2),
  price_stddev numeric(14,2),
  observed_at timestamptz not null default now(),
  evidence_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.profit_snapshot (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references public.supplier_offer(id) on delete cascade,
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

create unique index if not exists supplier_name_unique on public.supplier(name);
create unique index if not exists supplier_product_supplier_external_unique on public.supplier_product(supplier_id, supplier_product_id);
create unique index if not exists supplier_product_identifier_unique on public.supplier_product_identifier(supplier_product_id, identifier_type, identifier_value);
create unique index if not exists supplier_offer_product_unique on public.supplier_offer(supplier_product_id);
create unique index if not exists supplier_offer_freshness_offer_unique on public.supplier_offer_freshness(supplier_offer_id);
create unique index if not exists identity_match_supplier_product_unique on public.identity_match(supplier_product_id);
create index if not exists market_observation_product_observed_idx on public.market_observation(master_product_id, observed_at desc);
create index if not exists profit_snapshot_offer_calculated_idx on public.profit_snapshot(supplier_offer_id, calculated_at desc);

grant select, insert, update on public.supplier, public.supplier_product, public.supplier_product_identifier,
  public.supplier_offer, public.supplier_offer_snapshot, public.supplier_offer_freshness,
  public.master_product, public.product_identifier, public.product_variant, public.identity_match,
  public.market_observation, public.profit_snapshot to service_role;

-- MATCHER domain integrity hardening
-- Applies after db/schema.sql.
-- Keeps stable supplier identity separate from time-varying offer observations.

create table if not exists supplier_product_identifier (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references supplier_product(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('JAN','EAN','UPC','MPN','SKU','SUPPLIER_PRODUCT_NO')),
  identifier_value text not null,
  normalized_value text not null,
  source text,
  created_at timestamptz not null default now(),
  unique (supplier_product_id, identifier_type, normalized_value)
);

create index if not exists idx_supplier_product_identifier_lookup
  on supplier_product_identifier(identifier_type, normalized_value);

create table if not exists identity_hard_block (
  id uuid primary key default gen_random_uuid(),
  match_result_id uuid not null references match_result(id) on delete cascade,
  reason_code text not null check (
    reason_code in (
      'MPN_MISMATCH',
      'SET_COUNT_MISMATCH',
      'COLOR_MISMATCH',
      'SIZE_MISMATCH',
      'CONDITION_MISMATCH',
      'VARIANT_MISMATCH'
    )
  ),
  source_value text,
  master_value text,
  created_at timestamptz not null default now(),
  unique (match_result_id, reason_code)
);

create index if not exists idx_identity_hard_block_match
  on identity_hard_block(match_result_id);

create table if not exists freshness_policy (
  id uuid primary key default gen_random_uuid(),
  metric text not null unique check (metric in ('PRICE','INVENTORY','SHIPPING')),
  max_age_seconds integer not null check (max_age_seconds > 0),
  updated_at timestamptz not null default now()
);

insert into freshness_policy(metric, max_age_seconds)
values
  ('PRICE', 86400),
  ('INVENTORY', 21600),
  ('SHIPPING', 604800)
on conflict (metric) do nothing;

create table if not exists supplier_offer_observation (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  observed_at timestamptz not null default now(),
  price numeric(14,2) check (price is null or price >= 0),
  shipping_cost numeric(14,2) check (shipping_cost is null or shipping_cost >= 0),
  inventory integer check (inventory is null or inventory >= 0),
  orderability orderability_status,
  price_observed_at timestamptz,
  inventory_observed_at timestamptz,
  shipping_observed_at timestamptz,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists idx_supplier_offer_observation_offer
  on supplier_offer_observation(supplier_offer_id, observed_at desc);

create table if not exists supplier_offer_freshness (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  price_observed_at timestamptz,
  inventory_observed_at timestamptz,
  shipping_observed_at timestamptz,
  checked_at timestamptz not null default now(),
  unique (supplier_offer_id)
);

create index if not exists idx_supplier_offer_freshness_checked
  on supplier_offer_freshness(checked_at desc);

alter table match_result
  add column if not exists hard_block boolean not null default false;

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

drop trigger if exists match_result_hard_block_guard on match_result;
create trigger match_result_hard_block_guard
before insert or update on match_result
for each row execute function prevent_auto_link_hard_block();

create index if not exists idx_match_hard_block
  on match_result(hard_block, created_at desc);

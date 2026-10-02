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

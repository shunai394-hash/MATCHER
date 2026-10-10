create table if not exists public.profit_fee_policy (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null,
  marketplace_fee_rate numeric(8,6) not null check (marketplace_fee_rate >= 0 and marketplace_fee_rate <= 1),
  payment_fee_rate numeric(8,6) not null check (payment_fee_rate >= 0 and payment_fee_rate <= 1),
  fixed_fee numeric(14,2) not null default 0 check (fixed_fee >= 0),
  tax_rate numeric(8,6) not null default 0 check (tax_rate >= 0 and tax_rate <= 1),
  evidence_url text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (marketplace)
);

alter table public.profit_snapshot
  add column if not exists market_observation_id uuid references public.market_observation(id) on delete set null;

create unique index if not exists market_observation_identity_window_unique
  on public.market_observation(master_product_id, source, window_start, window_end);

create unique index if not exists profit_snapshot_offer_market_unique
  on public.profit_snapshot(supplier_offer_id, market_observation_id)
  where market_observation_id is not null;

grant select, insert, update on public.profit_fee_policy to service_role;
grant select, insert, update on public.market_observation, public.profit_snapshot to service_role;

-- Pass 12: real market observations are required before an opportunity can be ranked as buy-worthy.
-- Raw observations stay separate from supplier offers so demand, competition, and price stability
-- cannot be silently inferred from procurement-side data.
create table if not exists public.market_observation (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references public.master_product(id) on delete cascade,
  source text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  sales_count integer not null default 0 check (sales_count >= 0),
  active_listing_count integer not null default 0 check (active_listing_count >= 0),
  median_sale_price numeric check (median_sale_price is null or median_sale_price >= 0),
  price_stddev numeric check (price_stddev is null or price_stddev >= 0),
  observed_at timestamptz not null default now(),
  evidence_url text,
  created_at timestamptz not null default now(),
  check (window_end > window_start)
);

create index if not exists idx_market_observation_product_time
  on public.market_observation(master_product_id, observed_at desc);
create index if not exists idx_market_observation_source_time
  on public.market_observation(source, observed_at desc);

alter table public.market_observation enable row level security;

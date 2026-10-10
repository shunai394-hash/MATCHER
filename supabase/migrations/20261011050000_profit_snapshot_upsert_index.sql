drop index if exists public.profit_snapshot_offer_market_unique;
create unique index if not exists profit_snapshot_offer_market_unique
  on public.profit_snapshot(supplier_offer_id, market_observation_id);

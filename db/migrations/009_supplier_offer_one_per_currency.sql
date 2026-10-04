-- One supplier_offer per (supplier_product_id, currency).
-- Ingest already reuses the oldest offer for the pair; this index makes concurrent
-- ingests converge instead of creating duplicates. It refuses to apply while
-- duplicates exist so no data is merged or deleted silently.
do $$
begin
  if exists (
    select 1 from supplier_offer group by supplier_product_id, currency having count(*) > 1
  ) then
    raise exception 'duplicate supplier_offer rows exist for (supplier_product_id, currency); resolve them before applying this migration';
  end if;
end $$;

create unique index if not exists idx_supplier_offer_product_currency
  on supplier_offer(supplier_product_id, currency);

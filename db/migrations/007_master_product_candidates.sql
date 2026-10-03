-- 007: Master product candidates.
--
-- MATCHER may propose a new canonical product when a supplier product has strong
-- identifiers (valid GTIN, or brand + model number) but no existing master matches.
-- Such a master is created as a CANDIDATE: status = 'INACTIVE' and
-- approval_status = 'CANDIDATE'. It is never linked with AUTO_LINK and never sold
-- until a human approves it (approval_status = 'APPROVED', status = 'ACTIVE').
-- Existing rows default to APPROVED / MANUAL, so current behaviour is unchanged.

alter table master_product add column if not exists approval_status text not null default 'APPROVED';
alter table master_product add column if not exists origin text not null default 'MANUAL';
alter table master_product add column if not exists origin_supplier_product_id uuid references supplier_product(id) on delete set null;
alter table master_product add column if not exists reviewed_at timestamptz;
alter table master_product add column if not exists reviewed_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'master_product_approval_status_check') then
    alter table master_product add constraint master_product_approval_status_check
      check (approval_status in ('CANDIDATE', 'APPROVED', 'REJECTED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'master_product_origin_check') then
    alter table master_product add constraint master_product_origin_check
      check (origin in ('MANUAL', 'SUPPLIER_CANDIDATE'));
  end if;
  -- A master that is not approved can never be ACTIVE (and therefore never sellable).
  if not exists (select 1 from pg_constraint where conname = 'master_product_active_requires_approval') then
    alter table master_product add constraint master_product_active_requires_approval
      check (status <> 'ACTIVE' or approval_status = 'APPROVED');
  end if;
end $$;

create index if not exists idx_master_product_approval on master_product(approval_status, created_at desc);
-- At most one candidate per originating supplier product (prevents duplicate proposals).
create unique index if not exists idx_master_product_origin_supplier_product
  on master_product(origin_supplier_product_id) where origin_supplier_product_id is not null;

-- Rollback of 007. Refuses once MATCHER has proposed or reviewed any master: without these columns a
-- candidate (INACTIVE) master could no longer be told apart from a manually deactivated one.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'master_product' and column_name = 'approval_status')
     and exists (select 1 from master_product where approval_status <> 'APPROVED' or origin <> 'MANUAL' or origin_supplier_product_id is not null or reviewed_at is not null) then
    raise exception 'ROLLBACK 007 stopped: master_product rows were created or reviewed through the candidate flow. Resolve them by hand; nothing was changed.';
  end if;
end $$;
drop index if exists idx_master_product_origin_supplier_product;
drop index if exists idx_master_product_approval;
alter table master_product drop constraint if exists master_product_active_requires_approval;
alter table master_product drop constraint if exists master_product_origin_check;
alter table master_product drop constraint if exists master_product_approval_status_check;
alter table master_product drop column if exists reviewed_by;
alter table master_product drop column if exists reviewed_at;
alter table master_product drop column if exists origin_supplier_product_id;
alter table master_product drop column if exists origin;
alter table master_product drop column if exists approval_status;

-- Rollback of 008. Refuses if any purchase_review already carries requester / verified-terms data
-- (dropping the columns would delete that audit trail). Export those rows first if you must roll back.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchase_review' and column_name = 'requested_by_email')
     and exists (select 1 from purchase_review where requested_by_user_id is not null or requested_by_email is not null or verified_terms <> '{}'::jsonb) then
    raise exception 'ROLLBACK 008 stopped: purchase_review rows hold requester/verified_terms data. Export them first; nothing was changed.';
  end if;
end $$;
alter table purchase_review drop column if exists verified_terms;
alter table purchase_review drop column if exists requested_by_email;
alter table purchase_review drop column if exists requested_by_user_id;

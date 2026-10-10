alter table public.freshness_policy drop constraint if exists freshness_policy_data_type_check;
alter table public.freshness_policy add constraint freshness_policy_data_type_check
  check (data_type in ('PRICE', 'INVENTORY', 'SHIPPING', 'MARKET'));
insert into public.freshness_policy(data_type, max_age_seconds)
values ('MARKET', 86400)
on conflict (data_type) do nothing;

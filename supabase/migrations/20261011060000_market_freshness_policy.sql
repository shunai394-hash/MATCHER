alter table public.freshness_policy drop constraint if exists freshness_policy_metric_check;
alter table public.freshness_policy add constraint freshness_policy_metric_check
  check (metric in ('PRICE', 'INVENTORY', 'SHIPPING', 'MARKET'));
insert into public.freshness_policy(metric, max_age_seconds)
values ('MARKET', 86400)
on conflict (metric) do nothing;

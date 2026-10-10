create table if not exists public.freshness_policy (
  id uuid primary key default gen_random_uuid(),
  data_type text not null unique,
  max_age_seconds integer not null check (max_age_seconds > 0),
  updated_at timestamptz not null default now()
);
alter table public.freshness_policy drop constraint if exists freshness_policy_data_type_check;
alter table public.freshness_policy add constraint freshness_policy_data_type_check
  check (data_type in ('PRICE', 'INVENTORY', 'SHIPPING', 'MARKET'));
insert into public.freshness_policy(data_type, max_age_seconds)
values
  ('PRICE', 86400),
  ('INVENTORY', 21600),
  ('SHIPPING', 604800),
  ('MARKET', 86400)
on conflict (data_type) do nothing;
grant select on public.freshness_policy to service_role;

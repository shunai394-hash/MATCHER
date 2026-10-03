-- 006: Align the migration history with the live Supabase schema.
--
-- The live database (project bihnncycujxifczvhfhr) was changed outside this history:
--   * identity decisions live in identity_match (there is no match_result),
--   * supplier_offer carries no price/stock columns; observations are append-only
--     rows in supplier_offer_snapshot,
--   * supplier_product has product_name / variant attributes / first_seen_at / last_seen_at,
--   * supplier_offer_freshness has updated_at.
--
-- Every statement is idempotent so this migration is safe on BOTH
--   (a) a database built from 001-005, and
--   (b) the live database, where most of these objects already exist (no-op there).
-- Columns are only dropped when the project owner confirmed they do not exist in
-- production, and only after their data has been copied to the new location.

/* ---------- supplier_product ---------- */

alter table supplier_product add column if not exists product_name text;
alter table supplier_product add column if not exists manufacturer text;
alter table supplier_product add column if not exists color text;
alter table supplier_product add column if not exists size text;
alter table supplier_product add column if not exists capacity text;
alter table supplier_product add column if not exists generation text;
alter table supplier_product add column if not exists set_count integer;
alter table supplier_product add column if not exists condition text;
alter table supplier_product add column if not exists first_seen_at timestamptz not null default now();
alter table supplier_product add column if not exists last_seen_at timestamptz not null default now();

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_product' and column_name = 'title') then
    execute 'update supplier_product set product_name = coalesce(product_name, title)';
    execute 'alter table supplier_product drop column title';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_product' and column_name = 'fetched_at') then
    execute 'update supplier_product set last_seen_at = greatest(last_seen_at, fetched_at), first_seen_at = least(first_seen_at, fetched_at)';
    execute 'alter table supplier_product drop column fetched_at';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_product' and column_name = 'source_updated_at') then
    execute 'alter table supplier_product drop column source_updated_at';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_product_set_count_check') then
    alter table supplier_product add constraint supplier_product_set_count_check check (set_count is null or set_count > 0);
  end if;
end $$;

create index if not exists idx_supplier_product_last_seen on supplier_product(last_seen_at desc);

/* ---------- supplier_offer_snapshot (prices, shipping, stock) ---------- */

create table if not exists supplier_offer_snapshot (
  id uuid primary key default gen_random_uuid(),
  supplier_offer_id uuid not null references supplier_offer(id) on delete cascade,
  supplier_cost numeric(14,2) check (supplier_cost is null or supplier_cost >= 0),
  shipping_cost numeric(14,2) check (shipping_cost is null or shipping_cost >= 0),
  inventory integer check (inventory is null or inventory >= 0),
  shipping_confidence numeric(5,4) check (shipping_confidence is null or (shipping_confidence >= 0 and shipping_confidence <= 1)),
  observed_at timestamptz not null default now()
);
create index if not exists idx_supplier_offer_snapshot_offer on supplier_offer_snapshot(supplier_offer_id, observed_at desc);

alter table supplier_offer add column if not exists updated_at timestamptz not null default now();

do $$
begin
  -- Legacy price/stock columns on supplier_offer: copy every observation into a snapshot, then drop.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_offer' and column_name = 'cost') then
    execute $sql$
      insert into supplier_offer_snapshot (supplier_offer_id, supplier_cost, shipping_cost, inventory, shipping_confidence, observed_at)
      select id, cost, shipping_cost, inventory, case when shipping_verified then 1 else 0 end, observed_at
      from supplier_offer
      where cost is not null or shipping_cost is not null or inventory is not null
    $sql$;
    execute 'alter table supplier_offer drop column cost';
    execute 'alter table supplier_offer drop column if exists shipping_cost';
    execute 'alter table supplier_offer drop column if exists inventory';
    execute 'alter table supplier_offer drop column if exists shipping_verified';
    execute 'alter table supplier_offer drop column if exists observed_at';
  end if;
end $$;
drop index if exists idx_supplier_offer_observed;

/* ---------- supplier_offer_freshness ---------- */

alter table supplier_offer_freshness add column if not exists updated_at timestamptz not null default now();
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_offer_freshness' and column_name = 'checked_at') then
    execute 'update supplier_offer_freshness set updated_at = checked_at';
  end if;
end $$;

/* ---------- identity_match (formerly match_result) ---------- */

do $$
begin
  if to_regclass('public.identity_match') is null and to_regclass('public.match_result') is not null then
    alter table match_result rename to identity_match;
    alter index if exists idx_match_supplier_product rename to idx_identity_match_supplier_product;
    alter index if exists idx_match_master rename to idx_identity_match_master;
    alter index if exists idx_match_hard_block rename to idx_identity_match_hard_block;
    if exists (select 1 from pg_trigger where tgname = 'match_result_hard_block_guard') then
      alter trigger match_result_hard_block_guard on identity_match rename to identity_match_hard_block_guard;
    end if;
  end if;
end $$;

create table if not exists identity_match (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references supplier_product(id) on delete cascade,
  master_product_id uuid references master_product(id) on delete set null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  decision identity_decision not null,
  hard_block boolean not null default false,
  created_at timestamptz not null default now()
);
alter table identity_match add column if not exists hard_block boolean not null default false;
create index if not exists idx_identity_match_supplier_product on identity_match(supplier_product_id, created_at desc);
create index if not exists idx_identity_match_master on identity_match(master_product_id, created_at desc);

create or replace function prevent_auto_link_hard_block()
returns trigger
language plpgsql
as $$
begin
  if new.hard_block and new.decision = 'AUTO_LINK' then
    raise exception 'AUTO_LINK is forbidden when hard_block=true';
  end if;
  return new;
end;
$$;
drop trigger if exists identity_match_hard_block_guard on identity_match;
create trigger identity_match_hard_block_guard
before insert or update on identity_match
for each row execute function prevent_auto_link_hard_block();

/* ---------- quality patrol (used by /api/quality-patrol; missing from 001-005) ---------- */

create table if not exists quality_patrol_run (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('RUNNING','PASSED','FAILED')),
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists quality_diagnosis (
  id uuid primary key default gen_random_uuid(),
  patrol_run_id uuid not null references quality_patrol_run(id) on delete cascade,
  severity text not null check (severity in ('INFO','WARN','ERROR')),
  code text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_gate_evaluated on quality_gate_result(evaluated_at desc);

alter table supplier_offer_snapshot enable row level security;
alter table identity_match enable row level security;
alter table quality_patrol_run enable row level security;
alter table quality_diagnosis enable row level security;

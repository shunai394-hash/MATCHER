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
-- No data is merged, rewritten or deleted automatically: legacy columns are dropped only when
-- they are entirely NULL; otherwise the migration raises and (with --single-transaction)
-- leaves the database untouched. Apply with: psql --single-transaction -v ON_ERROR_STOP=1 -f ...

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

-- Legacy columns (absent in production per the owner). This migration never merges or deletes
-- data automatically: if a legacy column still holds any value it STOPS (the whole transaction
-- rolls back) and the data must be migrated by a human. Only an all-NULL legacy column is dropped.
create or replace function pg_temp.matcher_drop_empty_legacy_column(tbl text, col text)
returns void
language plpgsql
as $$
declare filled bigint;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name = col) then
    execute format('select count(*) from public.%I where %I is not null', tbl, col) into filled;
    if filled > 0 then
      raise exception 'MATCHER 006 stopped: legacy column %.% still holds % non-null value(s). Migrate it manually; nothing was changed.', tbl, col, filled;
    end if;
    execute format('alter table public.%I drop column %I', tbl, col);
  end if;
end;
$$;

do $$
begin
  perform pg_temp.matcher_drop_empty_legacy_column('supplier_product', 'title');
  perform pg_temp.matcher_drop_empty_legacy_column('supplier_product', 'fetched_at');
  perform pg_temp.matcher_drop_empty_legacy_column('supplier_product', 'source_updated_at');
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
  -- Legacy price/stock columns on supplier_offer. Prices/stock now live in supplier_offer_snapshot.
  -- Same rule: stop if any value exists (no automatic copy/merge), drop only all-NULL columns.
  -- shipping_verified is NOT NULL DEFAULT false in 001, so it only counts as data when true.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_offer' and column_name = 'shipping_verified') then
    if exists (select 1 from supplier_offer where shipping_verified) then
      raise exception 'MATCHER 006 stopped: legacy column supplier_offer.shipping_verified is true on some rows. Migrate it manually; nothing was changed.';
    end if;
    alter table supplier_offer drop column shipping_verified;
  end if;
  perform pg_temp.matcher_drop_empty_legacy_column('supplier_offer', 'cost');
  perform pg_temp.matcher_drop_empty_legacy_column('supplier_offer', 'shipping_cost');
  perform pg_temp.matcher_drop_empty_legacy_column('supplier_offer', 'inventory');
  -- observed_at is NOT NULL DEFAULT now() in 001: it carries no observation unless a price/stock
  -- value existed, which was rejected above. Drop it only when those columns are gone.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_offer' and column_name = 'observed_at')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_offer' and column_name in ('cost', 'shipping_cost', 'inventory')) then
    alter table supplier_offer drop column observed_at;
  end if;
end $$;

/* ---------- supplier_offer_freshness ---------- */

do $$
begin
  -- Backfill only at the moment the column is created, so re-running 006 never rewinds updated_at.
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_offer_freshness' and column_name = 'updated_at') then
    alter table supplier_offer_freshness add column updated_at timestamptz not null default now();
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_offer_freshness' and column_name = 'checked_at') then
      execute 'update supplier_offer_freshness set updated_at = checked_at where checked_at is not null';
    end if;
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

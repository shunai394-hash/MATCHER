-- MATCHER production preflight (READ ONLY). Run BEFORE applying db/migrations/006-009:
--   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f db/ops/preflight.sql > preflight-$(date +%Y%m%d%H%M).log 2>&1
-- Every finding is printed as:  PREFLIGHT | <verdict> | <check> | <detail>
--   STOP   = do not apply; the named migration would refuse or the data needs a human decision
--   REVIEW = apply only after a human has looked at it
--   INFO   = facts recorded for the audit trail / rollback
-- The transaction is READ ONLY and rolled back: this script cannot change anything.
\set QUIET on
begin transaction read only;
set local client_min_messages = notice;

\echo '== tables that exist / are missing'
select 'PREFLIGHT | ' || case when to_regclass('public.' || t) is null then
         case when t = 'match_result' then 'OK     | absent (expected: live DB uses identity_match)'
              when t in ('identity_hard_block','supplier_offer_observation','match_evidence','quality_run') then 'INFO   | missing (not used by the application)'
              when t in ('quality_patrol_run','quality_diagnosis','supplier_offer_snapshot','identity_match') then 'INFO   | missing (006 creates it)'
              when t in ('purchase_review','master_product','supplier_offer','supplier_product','supplier_offer_freshness','freshness_policy') then 'STOP   | missing (required)'
              else 'REVIEW | missing' end
       when t = 'match_result' then 'REVIEW | exists (reported absent; 006 renames it only if identity_match is missing)'
       else 'INFO   | exists' end || ' | table ' || t
from unnest(array['master_product','product_identifier','product_variant','suppliers','supplier_product','supplier_product_identifier',
  'supplier_offer','supplier_offer_snapshot','supplier_offer_freshness','freshness_policy','identity_match','match_result',
  'market_price_observation','profit_snapshot','quality_gate_result','ingestion_run','quality_run','quality_patrol_run',
  'quality_diagnosis','purchase_review','identity_hard_block','supplier_offer_observation','match_evidence']) as t
order by 1;

\echo '== columns of every MATCHER table (record this output; it is the real production schema)'
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('master_product','product_identifier','product_variant','suppliers','supplier_product',
  'supplier_product_identifier','supplier_offer','supplier_offer_snapshot','supplier_offer_freshness','freshness_policy','identity_match',
  'match_result','market_price_observation','profit_snapshot','quality_gate_result','ingestion_run','quality_run','quality_patrol_run',
  'quality_diagnosis','purchase_review')
order by table_name, ordinal_position;

\echo '== constraints (CHECK / UNIQUE / FK) and indexes on those tables'
select cl.relname as table_name, co.conname, pg_get_constraintdef(co.oid) as definition
from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace
where n.nspname = 'public' order by 1, 2;
select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2;

\echo '== RLS status and policies (006 enables RLS on supplier_offer_snapshot, identity_match, quality_patrol_run, quality_diagnosis)'
select 'PREFLIGHT | ' || case when not c.relrowsecurity and c.relname in ('supplier_offer_snapshot','identity_match','quality_patrol_run','quality_diagnosis')
         then 'REVIEW | RLS is OFF now; 006 turns it ON (anon/authenticated clients lose access unless a policy exists)' else 'INFO   | rls=' || c.relrowsecurity end
       || ' | rls ' || c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1;
select schemaname, tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' order by 2, 3;

\echo '== triggers and the guard function 006 replaces (save for rollback)'
select tgrelid::regclass as table_name, tgname, pg_get_triggerdef(oid) from pg_trigger where not tgisinternal order by 1, 2;
select 'PREFLIGHT | INFO   | function prevent_auto_link_hard_block (006 runs CREATE OR REPLACE) | ' || coalesce((select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'prevent_auto_link_hard_block' limit 1), 'absent');

\echo '== data checks'
do $$
declare
  r record; v bigint; key_col text;
  legacy text[][] := array[
    ['supplier_product','title'], ['supplier_product','fetched_at'], ['supplier_product','source_updated_at'],
    ['supplier_offer','cost'], ['supplier_offer','shipping_cost'], ['supplier_offer','inventory'], ['supplier_offer','observed_at']];
  i int;
  has_col boolean;
begin
  -- 006: legacy columns must be absent or entirely NULL (006 stops otherwise; it never merges or deletes).
  for i in 1 .. array_length(legacy, 1) loop
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = legacy[i][1] and column_name = legacy[i][2]) into has_col;
    if has_col then
      execute format('select count(*) from public.%I where %I is not null', legacy[i][1], legacy[i][2]) into v;
      raise notice 'PREFLIGHT | % | legacy column %.% | % non-null value(s)%', case when v > 0 then 'STOP  ' else 'REVIEW' end, legacy[i][1], legacy[i][2], v,
        case when v > 0 then ' -> 006 will refuse; reported schema was wrong, decide manually' else ' -> exists although reported absent; 006 drops it (empty)' end;
    else
      raise notice 'PREFLIGHT | OK     | legacy column %.% | absent', legacy[i][1], legacy[i][2];
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_offer' and column_name = 'shipping_verified') then
    execute 'select count(*) from supplier_offer where shipping_verified' into v;
    raise notice 'PREFLIGHT | % | legacy column supplier_offer.shipping_verified | % true row(s)', case when v > 0 then 'STOP  ' else 'REVIEW' end, v;
  end if;

  if to_regclass('public.match_result') is not null and to_regclass('public.identity_match') is not null then
    raise notice 'PREFLIGHT | REVIEW | match_result AND identity_match both exist | 006 leaves both; code uses identity_match only';
  end if;

  -- freshness_policy: which key column does production really use?
  select string_agg(column_name, ',') into key_col from information_schema.columns
   where table_schema = 'public' and table_name = 'freshness_policy' and column_name in ('data_type', 'metric');
  raise notice 'PREFLIGHT | % | freshness_policy key column | %', case when key_col is null then 'STOP  ' else 'INFO  ' end, coalesce(key_col, 'neither data_type nor metric');
  if key_col is not null then
    for r in execute format('select upper(%I::text) as k, max_age_seconds from freshness_policy order by 1', split_part(key_col, ',', 1)) loop
      raise notice 'PREFLIGHT | INFO   | freshness_policy row | % = % s', r.k, r.max_age_seconds;
    end loop;
    for r in select unnest(array['PRICE','INVENTORY','SHIPPING']) as k loop
      execute format('select count(*) from freshness_policy where upper(%I::text) = $1 and max_age_seconds > 0', split_part(key_col, ',', 1)) into v using r.k;
      if v = 0 then raise notice 'PREFLIGHT | REVIEW | freshness_policy % missing | every offer will be BLOCKED (safe, but nothing becomes an opportunity)', r.k; end if;
    end loop;
  end if;

  -- 009: duplicates stop it. Case / whitespace variants are not caught by the unique index.
  if to_regclass('public.supplier_offer') is not null then
    select count(*) into v from (select 1 from supplier_offer group by supplier_product_id, currency having count(*) > 1) d;
    raise notice 'PREFLIGHT | % | supplier_offer duplicates (product, currency) | % group(s)%', case when v > 0 then 'STOP  ' else 'OK    ' end, v, case when v > 0 then ' -> 009 will refuse; resolve by hand' else '' end;
    select count(*) into v from (select 1 from supplier_offer group by supplier_product_id, upper(trim(currency::text)) having count(*) > 1) d;
    if v > 0 then raise notice 'PREFLIGHT | REVIEW | supplier_offer duplicates ignoring case/space | % group(s) (unique index will not catch these)', v; end if;
    select count(*) into v from supplier_offer where currency is null or currency::text <> upper(trim(currency::text));
    if v > 0 then raise notice 'PREFLIGHT | REVIEW | supplier_offer.currency null/non-normalized | % row(s) (ingest writes upper-case; such offers will not be reused)', v; end if;
    for r in select currency::text as c, count(*) as n from supplier_offer group by 1 order by 2 desc loop
      raise notice 'PREFLIGHT | INFO   | supplier_offer currency | % = %', r.c, r.n;
    end loop;
  end if;

  -- 006: CHECK (set_count > 0) validates existing rows.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_product' and column_name = 'set_count') then
    execute 'select count(*) from supplier_product where set_count is not null and set_count <= 0' into v;
    raise notice 'PREFLIGHT | % | supplier_product.set_count <= 0 | % row(s)', case when v > 0 then 'STOP  ' else 'OK    ' end, v;
  end if;

  -- 006: guard trigger rejects future writes of AUTO_LINK + hard_block.
  if to_regclass('public.identity_match') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'identity_match' and column_name = 'hard_block') then
    execute 'select count(*) from identity_match where hard_block and decision = ''AUTO_LINK''' into v;
    raise notice 'PREFLIGHT | % | identity_match AUTO_LINK with hard_block | % row(s)', case when v > 0 then 'REVIEW' else 'OK    ' end, v;
  end if;

  -- 007: names it checks with IF NOT EXISTS must not already belong to something else.
  for r in select co.conname, cl.relname from pg_constraint co join pg_class cl on cl.oid = co.conrelid
           where co.conname in ('master_product_approval_status_check','master_product_origin_check','master_product_active_requires_approval','supplier_product_set_count_check') loop
    if (r.conname like 'master_product%' and r.relname = 'master_product') or (r.conname = 'supplier_product_set_count_check' and r.relname = 'supplier_product') then
      raise notice 'PREFLIGHT | INFO   | constraint % already on % | migration skips it (no-op); definition listed above', r.conname, r.relname;
    else
      raise notice 'PREFLIGHT | REVIEW | constraint name % belongs to % | the migration will SKIP creating its own', r.conname, r.relname;
    end if;
  end loop;
  for r in select column_name from information_schema.columns where table_schema = 'public' and table_name = 'master_product'
           and column_name in ('approval_status','origin','origin_supplier_product_id','reviewed_at','reviewed_by') loop
    raise notice 'PREFLIGHT | REVIEW | master_product.% already exists | 007 keeps the existing column as is', r.column_name;
  end loop;
  -- 007: existing masters become APPROVED by default; inactive ones stay INACTIVE.
  if to_regclass('public.master_product') is not null then
    for r in select status::text as s, count(*) as n from master_product group by 1 loop
      raise notice 'PREFLIGHT | INFO   | master_product status | % = % (007 marks them approval_status=APPROVED)', r.s, r.n;
    end loop;
  end if;

  -- quality patrol: the code writes status RUNNING/PASSED/FAILED and severity INFO/WARN/ERROR.
  for r in select cl.relname, pg_get_constraintdef(co.oid) as d from pg_constraint co join pg_class cl on cl.oid = co.conrelid
           where cl.relname in ('quality_patrol_run','quality_diagnosis') and co.contype = 'c' loop
    if (r.relname = 'quality_patrol_run' and r.d like '%RUNNING%' and r.d like '%PASSED%' and r.d like '%FAILED%')
       or (r.relname = 'quality_diagnosis' and r.d like '%INFO%' and r.d like '%WARN%' and r.d like '%ERROR%') then
      raise notice 'PREFLIGHT | OK     | % check | %', r.relname, r.d;
    else
      raise notice 'PREFLIGHT | REVIEW | % check | % (code writes status RUNNING/PASSED/FAILED, severity INFO/WARN/ERROR)', r.relname, r.d;
    end if;
  end loop;

  -- row counts (scale + rollback planning)
  for r in select unnest(array['master_product','supplier_product','supplier_offer','supplier_offer_snapshot','supplier_offer_freshness',
                               'identity_match','market_price_observation','profit_snapshot','quality_gate_result','purchase_review']) as t loop
    if to_regclass('public.' || r.t) is not null then
      execute format('select count(*) from public.%I', r.t) into v;
      raise notice 'PREFLIGHT | INFO   | rows % | %', r.t, v;
    end if;
  end loop;
end $$;

rollback;

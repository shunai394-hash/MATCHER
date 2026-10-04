#!/usr/bin/env bash
# Shared helpers: start/stop a throwaway PostgreSQL 16 cluster under .e2e/ (never touches any real database).
if [ -z "${PG_BIN:-}" ]; then
  if [ -x /usr/lib/postgresql/16/bin/initdb ]; then PG_BIN=/usr/lib/postgresql/16/bin
  else PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"; fi
fi
[ -x "$PG_BIN/initdb" ] || { echo "PostgreSQL server binaries not found (set PG_BIN)"; exit 1; }
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
AS_PG=()
if [ "$(id -u)" = "0" ]; then AS_PG=(runuser -u postgres --); fi

pg_start() { # $1 = data dir, $2 = port
  rm -rf "$1"; mkdir -p "$1"
  [ "$(id -u)" = "0" ] && chown -R postgres "$(dirname "$1")"
  "${AS_PG[@]}" "$PG_BIN/initdb" -D "$1" -U postgres --auth=trust >/dev/null
  "${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$1" -o "-p $2 -k /tmp -c listen_addresses=127.0.0.1" -l "$1.log" -w start >/dev/null
}
pg_stop() { "${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$1" -m fast stop >/dev/null 2>&1 || true; }
psql_db() { # $1 = port, $2 = db, rest = psql args
  local port="$1" db="$2"; shift 2
  "$PG_BIN/psql" -h 127.0.0.1 -p "$port" -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -X "$@"
}
# Normalized schema-only dump (stable across runs: drops version banners and pg_dump's random \restrict keys).
pg_schema_dump() { # $1 = port, $2 = db
  "$PG_BIN/pg_dump" -h 127.0.0.1 -p "$1" -U postgres -d "$2" --schema-only --no-owner --no-privileges \
    | grep -v -E '^(\\restrict|\\unrestrict|-- Dumped (from|by))' | cat -s
}

# Version-independent structural fingerprint of the public schema (what must be identical).
pg_fingerprint() { # $1 = port, $2 = db
  psql_db "$1" "$2" -At <<'SQL'
select 'table ' || c.relname || ' rls=' || c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
union all
select 'column ' || table_name || '.' || column_name || ' ' || data_type || coalesce('(' || character_maximum_length || ')', '') || coalesce(' ' || numeric_precision || ',' || numeric_scale, '') || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-')
  from information_schema.columns where table_schema = 'public'
union all
select 'constraint ' || cl.relname || ' ' || co.conname || ' ' || pg_get_constraintdef(co.oid) from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace where n.nspname = 'public'
union all
select 'index ' || indexname || ' ' || indexdef from pg_indexes where schemaname = 'public'
union all
select 'trigger ' || tgrelid::regclass || ' ' || tgname || ' ' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
union all
select 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname
union all
select 'function ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.proname not in (select proname from pg_proc pp join pg_depend d on d.objid = pp.oid and d.deptype = 'e')
union all
select 'data freshness_policy ' || coalesce(to_jsonb(f) ->> 'metric', to_jsonb(f) ->> 'data_type') || '=' || max_age_seconds from freshness_policy f
order by 1;
SQL
}

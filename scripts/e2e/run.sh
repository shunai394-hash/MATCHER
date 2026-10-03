#!/usr/bin/env bash
# End-to-end test against a real database stack:
#   Postgres (db/schema.sql + supabase/migrations/006) → PostgREST → /rest/v1 proxy → `next start` → HTTP scenario.
# The live Supabase project is never touched. Requires PostgreSQL 16 server binaries.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
WORK="$ROOT/.e2e"
mkdir -p "$WORK"

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/initdb" ] || { echo "PostgreSQL server binaries not found (set PG_BIN)"; exit 1; }
PGPORT="${E2E_PG_PORT:-54329}"; PGRST_PORT="${E2E_PGRST_PORT:-54330}"; PROXY_PORT="${E2E_PROXY_PORT:-54331}"; APP_PORT="${E2E_APP_PORT:-3107}"

POSTGREST="${POSTGREST_BIN:-$WORK/postgrest}"
if [ ! -x "$POSTGREST" ]; then
  curl -fsSL -o "$WORK/postgrest.tar.xz" https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  tar -xJf "$WORK/postgrest.tar.xz" -C "$WORK"
fi

AS_PG=()
if [ "$(id -u)" = "0" ]; then AS_PG=(runuser -u postgres --); fi
DATA="$WORK/pgdata"
rm -rf "$DATA"; mkdir -p "$DATA"
[ "$(id -u)" = "0" ] && chown -R postgres "$WORK"

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  "${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${AS_PG[@]}" "$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
"${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1" -l "$WORK/postgres.log" -w start >/dev/null
PSQL=(psql -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -d postgres -c "create database matcher"
"${PSQL[@]}" -d matcher -f db/schema.sql
for f in supabase/migrations/006_*.sql; do "${PSQL[@]}" -d matcher -f "$f"; done
"${PSQL[@]}" -d matcher <<'SQL'
create role anon nologin;
create role service_role nologin bypassrls;
create role authenticator login password 'e2e' noinherit;
grant anon, service_role to authenticator;
grant usage on schema public to anon, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
SQL

JWT_SECRET="matcher-e2e-secret-matcher-e2e-secret-0123456789"
SERVICE_KEY="$(node -e '
const c=require("crypto");const b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({role:"service_role",iss:"e2e",exp:Math.floor(Date.now()/1000)+7200});
process.stdout.write(h+"."+p+"."+c.createHmac("sha256",process.argv[1]).update(h+"."+p).digest("base64url"));' "$JWT_SECRET")"

PGRST_DB_URI="postgres://authenticator:e2e@127.0.0.1:$PGPORT/matcher" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT="$PGRST_PORT" PGRST_SERVER_HOST=127.0.0.1 \
  "$POSTGREST" >"$WORK/postgrest.log" 2>&1 & PIDS+=($!)
node scripts/e2e/proxy.mjs "$PROXY_PORT" "$PGRST_PORT" & PIDS+=($!)

export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$PROXY_PORT"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"
export MATCHER_INGEST_TOKEN="e2e-ingest-token"
export CRON_SECRET="e2e-cron-secret"
if [ "${E2E_SKIP_BUILD:-0}" != "1" ]; then npm run build >"$WORK/build.log" 2>&1 || { tail -50 "$WORK/build.log"; exit 1; }; fi
if curl -s -o /dev/null "http://127.0.0.1:$APP_PORT/"; then echo "port $APP_PORT already in use"; exit 1; fi
# Run the Next binary directly (not via npx) so the recorded PID is the server itself and cleanup stops it.
node node_modules/next/dist/bin/next start -p "$APP_PORT" >"$WORK/next.log" 2>&1 & PIDS+=($!)

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PGRST_PORT/" >/dev/null 2>&1 && curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT/" 2>/dev/null && break
  sleep 1
done

E2E_APP="http://127.0.0.1:$APP_PORT" E2E_REST="http://127.0.0.1:$PROXY_PORT/rest/v1" \
  node --experimental-strip-types --no-warnings scripts/e2e/flow.ts || { echo "--- next.log"; tail -40 "$WORK/next.log"; echo "--- postgrest.log"; tail -20 "$WORK/postgrest.log"; exit 1; }

# MATCHER

MATCHER is the product identity and supplier-offer integration layer, kept separate from EC Pulse API.

## Responsibilities

- Maintain canonical product records.
- Store identifiers such as JAN/EAN/UPC/MPN/SKU.
- Model product variants and media.
- Normalize supplier offers.
- Match supplier products to canonical products with confidence and evidence.
- Calculate expected profit from real cost components.
- Apply quality gates and return SELLABLE or BLOCKED.

## Project boundary

EC Pulse API remains the commerce data/API infrastructure.
MATCHER consumes relevant data and performs product-master, supplier-linking, profitability, and sellability decisions.

## Initial implementation order

1. Data model
2. Product master and identifiers
3. Supplier offers
4. Identity matching + evidence
5. Cost/profit calculation
6. Quality gate
7. Monitoring and automatic stop

See docs/data-model.md for the initial domain model.


## Running

Environment (server only):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase (service role, server-side only) |
| `MATCHER_INGEST_TOKEN` | Required header `x-matcher-ingest-token` for `/api/ingest`, `/api/opportunities/recompute` |
| `CRON_SECRET` | Lets Vercel Cron call `/api/opportunities/recompute` (see `vercel.json`) |
| `MATCHER_REVIEW_TOKEN` | Reviewer key for `/review` (purchase capture, master candidate approval) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser sign-in (Supabase Auth) for purchasers |
| `MATCHER_PURCHASER_EMAILS`, `MATCHER_ADMIN_EMAILS` | Comma-separated allowlists; or set `app_metadata.matcher_role` = `purchaser` / `admin` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Manual-capture purchase authorization |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | eBay Browse API (`POST /api/sources/import` with `source: "EBAY"`) |
| `KAKAKU_API_BASE_URL`, `KAKAKU_API_TOKEN` | 価格.com partner API (`source: "KAKAKU"`) |

Without a credential the corresponding path fails explicitly (401/403/503); nothing is simulated.

## Database changes

Production is changed **only** by `db/migrations/NNN_*.sql`, applied in order. Past migrations are never edited
or removed; a correction is a new migration. `db/schema.sql` is generated from the migration chain
(`npm run verify:migrations -- --write`) and is what local/CI E2E loads. CI fails if the two differ, re-applies
006+ on the reported production shape (`db/snapshots/`), and checks legacy data survives.

Checks:

```bash
npm run verify:gate && npm run verify:opportunity && npm run verify:identity && npm run verify:marketplace && npm run verify:schema
npm run verify:migrations   # migration chain == schema.sql, production shape, legacy data
npm run typecheck && npm run lint && npm run build
npm run test:e2e   # Postgres + PostgREST + next start, full ingest → recompute → opportunities scenario
```

`test:e2e` needs PostgreSQL 16 server binaries and downloads PostgREST into `.e2e/` (or set `POSTGREST_BIN`).

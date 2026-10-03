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
| `MATCHER_REVIEW_TOKEN` | Human purchase review API |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Manual-capture purchase authorization |

Checks:

```bash
npm run verify:gate && npm run verify:opportunity && npm run verify:schema   # unit + schema-usage audit
npm run typecheck && npm run lint && npm run build
npm run test:e2e   # Postgres + PostgREST + next start, full ingest → recompute → opportunities scenario
```

`test:e2e` needs PostgreSQL 16 server binaries and downloads PostgREST into `.e2e/` (or set `POSTGREST_BIN`).

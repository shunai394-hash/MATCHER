# MATCHER data model

MATCHER owns canonical product identity and supplier-offer normalization. It is independent from TRACER and EC Pulse API.

## Stable vs time-varying data

- `master_product`: canonical product identity.
- `product_identifier`, `product_variant`, `product_media`: identity and variant facts.
- `suppliers`: supplier registry.
- `supplier_product`: stable supplier-side product identity (`product_name`, brand, model, variant attributes, `first_seen_at` / `last_seen_at`).
- `supplier_offer`: one row per (supplier product, currency) with `orderability`. It holds **no** price or stock columns.
- `supplier_offer_snapshot`: append-only observations: `supplier_cost`, `shipping_cost`, `inventory`, `shipping_confidence`, `observed_at`.
- `supplier_offer_freshness`: per offer, when price / inventory / shipping were last actually observed (`updated_at` = last write).
- `freshness_policy`: max age per data type (PRICE, INVENTORY, SHIPPING; optional MARKET, default 7 days).
- `market_price_observation`: sale price and fees per master product, observed on a marketplace.

This separation prevents a new price/inventory observation from overwriting the supplier product itself.

`db/schema.sql` mirrors the live Supabase schema and is what CI / E2E run against.
There is no `match_result` table: identity decisions live in `identity_match`.

## Identity

`identity_match` is append-only; the newest row per supplier product is the current decision.
The recompute job writes a row only when the decision changes, never overrides a human `REJECT`,
and always records a newly detected hard conflict (`BLOCK`, `hard_block=true`).
Evidence is re-derived from identifiers and attributes when a candidate is displayed.

- Exact JAN/EAN/UPC can support AUTO_LINK.
- Exact model/MPN plus compatible brand/specs can support AUTO_LINK.
- Title/image-only inference cannot auto-link below the configured threshold.
- A hard mismatch (model, variant, set count, condition, etc.) can force BLOCK/REJECT even when the numeric confidence is high.
- Unknown is never converted into a positive match.

## Economics

`expected_profit = sale_price - supplier_cost - shipping_cost - payment_fee - marketplace_fee - tax - other_cost`.

A missing mandatory cost is incomplete, not zero. `cost_complete=false` prevents a profit result from being treated as fully verified.

## Sellability

SELLABLE requires, at minimum:

1. identity decision is AUTO_LINK;
2. variant-critical fields are verified;
3. supplier and offer are orderable;
4. inventory and price are fresh;
5. supplier cost and shipping are known;
6. required fees/tax are known;
7. expected profit is calculable;
8. no hard-block reason exists.

Anything unknown remains BLOCKED.

## Quality loop

`DETECTED -> DIAGNOSED -> REPAIRED -> TESTED -> RETESTED -> RESOLVED`

The `quality_run` table records the cause, repair, and retest result so failures are diagnosable rather than silently overwritten.

## Daily pipeline

1. `POST /api/ingest` (token `x-matcher-ingest-token`): supplier items and market observations. Input is validated before any write; any failed row makes the response non-2xx and is recorded in `ingestion_run`.
2. `POST|GET /api/opportunities/recompute` (ingest token, or `Authorization: Bearer $CRON_SECRET` from Vercel Cron at 05:50 JST): identity matching → `profit_snapshot` → `quality_gate_result`. Idempotent; BLOCKED results are written too so a stale SELLABLE can never linger.
3. `GET /api/opportunities`: re-checks live data and lists only offers that pass every gate *and* whose latest gate result is SELLABLE and newer than its inputs. With no qualifying data it returns an empty list plus `excluded` reason counts.

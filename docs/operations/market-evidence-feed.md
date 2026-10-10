# Market evidence feed and profit policy

MATCHER never turns a supplier price spread into a verified resale profit. The market feed must contain real sales evidence, and a fee policy must be backed by a public source.

## Feed endpoint contract

Set `MATCHER_MARKET_OBSERVATION_FEED_URL` in Vercel Production to an HTTPS URL that returns either a JSON array or `{"items":[...]}`. The endpoint is fetched only by an authenticated operator action. Redirects, non-HTTPS URLs, local/private hosts, payloads over 5 MB, and more than 1,000 items are rejected.

Each item must have this shape:

```json
{
  "identifierType": "JAN",
  "identifierValue": "<valid 13-digit JAN>",
  "source": "marketplace-key",
  "windowStart": "2026-10-01T00:00:00.000Z",
  "windowEnd": "2026-10-08T00:00:00.000Z",
  "salesCount": 12,
  "activeListingCount": 35,
  "medianSalePrice": 12345,
  "priceStddev": 850,
  "observedAt": "2026-10-11T00:00:00.000Z",
  "evidenceUrl": "https://public.example/real-sales-evidence"
}
```

Replace all example values with actual measured data. Do not estimate salesCount from active listings or treat an asking price as a sold price. The source must provide a real evidence URL and the measurement window.

## Fee policy

The feed's `source` value must match `profit_fee_policy.marketplace`. Add one active policy per marketplace in the Supabase SQL editor using the current official fee schedule and its public evidence URL. Rates are decimal fractions (0.10 = 10%); `fixed_fee` is in JPY.

Required columns: `marketplace`, `marketplace_fee_rate`, `payment_fee_rate`, `fixed_fee`, `tax_rate`, `evidence_url`, `active`. Never insert guessed rates. Update the policy whenever the platform's official fee schedule changes.

## Profit eligibility

A profit snapshot is only written when all of these exist and are fresh: valid exact JAN/EAN/UPC mapping, an AUTO_LINK identity without hard blocks, a real market observation, an active fee policy, supplier cost, shipping cost, positive inventory, and separate fresh price/inventory/shipping timestamps. Missing inputs are reported as skipped; they are not filled with zero.

The feed route is `POST /api/ingestion/market`, available only after operator login. The UI displays market observations saved, profit snapshots calculated, and records skipped for missing costs/policy.

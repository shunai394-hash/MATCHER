# MATCHER data model

MATCHER owns canonical product identity and supplier-offer normalization. It is independent from TRACER and EC Pulse API.

## Stable vs time-varying data

- `master_product`: canonical product identity.
- `product_identifier`, `product_variant`, `product_media`: identity and variant facts.
- `suppliers`: supplier registry.
- `supplier_product`: stable supplier-side product identity.
- `supplier_offer`: time-varying purchasable conditions observed from a supplier.

This separation prevents a new price/inventory observation from overwriting the supplier product itself.

## Identity

A match stores both a decision and auditable evidence.

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


## Identifier scope

Identifiers are not all globally unique.

- JAN / EAN / UPC are treated as global product identifiers and are unique across canonical products.
- MPN is interpreted with brand/context and is not globally unique by itself.
- SKU and supplier-specific identifiers are scoped to their owning context and must not collide merely because another system uses the same code.
- Normalization removes presentation differences such as case, spaces, and hyphens before identity comparison.

The identity matcher only returns AUTO_LINK for strong deterministic evidence (exact global identifier, brand + MPN, or brand + model number). Variant-critical mismatches are hard blocks. Missing or insufficient evidence remains REVIEW rather than being guessed.

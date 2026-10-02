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


<!-- CI verification checkpoint -->

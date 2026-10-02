# MATCHER data model

## Core relationship

master_product is the canonical product. One canonical product can have many supplier offers: master_product 1:N supplier_offer.

## Entities

### master_product
Canonical product identity independent of any supplier.

Suggested fields: id, brand, product_name, manufacturer, model_number, status, created_at, updated_at.

### product_identifier
Identifiers used to establish identity: JAN, EAN, UPC, MPN, SKU, SUPPLIER_PRODUCT_NO.

Suggested fields: id, master_product_id, identifier_type, identifier_value, source, is_primary.

### product_variant
Variant-level attributes that must not be silently mixed: color, size, capacity, generation, set_count, condition.

### product_media
Images and specifications associated with the canonical product or variant.

### supplier_offer
A supplier-specific purchasable offer. Suggested fields: id, master_product_id (nullable until matched), supplier, supplier_product_id, supplier_sku, cost, shipping_cost, inventory, currency, orderability, source_updated_at, fetched_at.

## Matching result

A supplier offer must carry an auditable match decision: confidence, evidence, and decision.

Example evidence:
- jan: exact
- mpn: exact
- brand: exact
- color: exact
- size: exact
- set_count: exact
- image: compatible

Decisions: AUTO_LINK, REVIEW, REJECT.

Critical mismatches must be able to force BLOCK even when a numeric confidence score is high.

## Profit

Expected profit must use actual cost components:

sale_price - supplier_cost - shipping_cost - payment_fee - marketplace_fee - tax - other_cost = expected_profit.

Unknown mandatory costs must not be treated as zero.

## Quality gate

The final sellability decision must consider stockout, stale price, stale inventory, identity confidence, model mismatch, set count mismatch, color mismatch, condition mismatch, shipping unknown, supplier status, sudden supplier price increase, and sudden sale price decrease.

Result: SELLABLE or BLOCKED.

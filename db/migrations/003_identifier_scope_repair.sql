-- MATCHER identifier scope repair
-- Existing product_identifier uniqueness was incorrectly global across all
-- identifier types. Canonical product-local identifiers must be unique per
-- master product, while JAN/EAN/UPC remain globally unique.

alter table product_identifier
  drop constraint if exists product_identifier_identifier_type_normalized_value_key;

create unique index if not exists idx_product_identifier_master_scope
  on product_identifier(master_product_id, identifier_type, normalized_value);

create unique index if not exists idx_product_identifier_global_gtin
  on product_identifier(identifier_type, normalized_value)
  where identifier_type in ('JAN', 'EAN', 'UPC');

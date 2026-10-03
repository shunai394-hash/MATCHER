-- Identifier scope repair.
-- MPN/SKU/SUPPLIER_PRODUCT_NO may legitimately repeat across different products
-- when scoped to their master product. JAN/EAN/UPC remain globally unique.

alter table product_identifier
  drop constraint if exists product_identifier_identifier_type_normalized_value_key;

create unique index if not exists idx_product_identifier_product_scoped
  on product_identifier(master_product_id, identifier_type, normalized_value);

create unique index if not exists idx_product_identifier_global_gtin
  on product_identifier(identifier_type, normalized_value)
  where identifier_type in ('JAN','EAN','UPC');

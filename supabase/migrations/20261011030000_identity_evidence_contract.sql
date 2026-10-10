alter table public.product_variant add column if not exists variant_key text;
alter table public.identity_match add column if not exists evidence jsonb not null default '[]'::jsonb;
alter table public.identity_match add column if not exists hard_block_reasons jsonb not null default '[]'::jsonb;
alter table public.identity_match alter column master_product_id set not null;

create unique index if not exists product_variant_master_variant_key_unique
  on public.product_variant(master_product_id, variant_key)
  where variant_key is not null;

create unique index if not exists product_identifier_global_gtin_unique
  on public.product_identifier(identifier_type, normalized_value)
  where identifier_type in ('JAN', 'EAN', 'UPC') and normalized_value is not null;

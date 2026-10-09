-- Permit the trusted server-side Supabase service role to persist supplier discovery.
-- Never grant these write privileges to anon or authenticated users.
do $migration$
declare
  table_name text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach table_name in array array[
      'supplier',
      'suppliers',
      'supplier_product',
      'supplier_product_identifier',
      'supplier_offer',
      'supplier_offer_snapshot',
      'supplier_offer_freshness'
    ]
    loop
      if to_regclass(format('public.%I', table_name)) is not null then
        execute format(
          'grant select, insert, update, delete on table public.%I to service_role',
          table_name
        );
      end if;
    end loop;
  end if;
end
$migration$;

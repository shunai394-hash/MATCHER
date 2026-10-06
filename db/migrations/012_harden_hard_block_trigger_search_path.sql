-- Pass 12: harden trigger execution against mutable search_path attacks.
create or replace function public.prevent_auto_link_hard_block()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.hard_block and new.decision = 'AUTO_LINK' then
    raise exception 'AUTO_LINK is forbidden when hard_block=true';
  end if;
  return new;
end;
$function$;

-- Allow the server-side service role to read the private evidence tables used by
-- the live opportunity scorer. Do not grant these tables to anon/authenticated.
grant select on table public.identity_match, public.profit_snapshot, public.market_observation to service_role;

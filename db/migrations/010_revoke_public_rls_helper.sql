-- Remove public execution of the internal RLS bootstrap helper.
-- The function is SECURITY DEFINER and must never be callable through the Data API.
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;

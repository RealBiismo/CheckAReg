-- Check A Reg hardening: SECURITY DEFINER RPCs must never inherit execution
-- from PUBLIC/anon. User-facing grants already target authenticated explicitly;
-- server-only calls use the service_role.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', fn.signature);
    execute format('revoke execute on function %s from anon', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end
$$;

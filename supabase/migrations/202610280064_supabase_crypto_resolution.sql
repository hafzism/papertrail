-- Managed Supabase installs pgcrypto in `extensions`; security-definer RPCs
-- must resolve digest/gen_random_bytes there as well as in the local harness.
do $$
declare v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and (p.prosrc like '%digest(%' or p.prosrc like '%gen_random_bytes(%')
  loop
    execute format('alter function %s set search_path = public, extensions, storage, pg_temp',v_function);
  end loop;
end $$;

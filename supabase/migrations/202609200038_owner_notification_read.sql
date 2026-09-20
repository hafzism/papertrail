-- Owners may acknowledge only their own private notification. Acknowledgement is
-- not a dismissal of the underlying requirement, impact, or approval boundary.
create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then raise exception 'NOTIFICATION_AUTH_REQUIRED'; end if;
  update public.notifications set read_at = coalesce(read_at, now())
  where id = p_notification_id and owner_id = v_owner_id;
  return found;
end;
$$;
revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

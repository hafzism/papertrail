-- The owner can resolve their own private action record. This records a local
-- review choice only; it never asserts that an institution accepted anything.
create or replace function public.resolve_owner_followup_action(p_action_id uuid, p_state text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then raise exception 'ACTIVITY_AUTH_REQUIRED'; end if;
  if p_state not in ('completed', 'dismissed') then raise exception 'FOLLOWUP_ACTION_RESOLUTION_INVALID'; end if;
  update public.followup_actions set state = p_state::public.followup_action_state
    where id = p_action_id and owner_id = v_owner_id and state not in ('completed', 'dismissed', 'expired', 'not_applicable');
  if not found then raise exception 'FOLLOWUP_ACTION_NOT_RESOLVABLE'; end if;
  return true;
end;
$$;
revoke all on function public.resolve_owner_followup_action(uuid, text) from public, anon;
grant execute on function public.resolve_owner_followup_action(uuid, text) to authenticated;

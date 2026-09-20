-- Application lifecycle/readiness transitions are authoritative server operations.
-- Owners can create a draft through this narrow function but cannot forge submitted/accepted state.

drop policy if exists applications_owner on public.applications;
create policy applications_owner_read on public.applications for select using (owner_id = auth.uid());

revoke insert, update, delete on public.applications from authenticated;
grant select on public.applications to authenticated;
revoke all on public.application_events from public, anon, authenticated;
grant select on public.application_events to authenticated;

create or replace function public.create_application_draft(p_title text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_application_id uuid;
begin
  if v_owner_id is null then raise exception 'APPLICATION_CREATE_UNAUTHENTICATED'; end if;
  if char_length(trim(p_title)) < 1 or char_length(trim(p_title)) > 200 then raise exception 'APPLICATION_CREATE_INVALID_TITLE'; end if;

  insert into public.applications (owner_id, title)
  values (v_owner_id, trim(p_title))
  returning id into v_application_id;

  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary)
  values (v_owner_id, v_application_id, 1, 'owner', 'application_draft_created', 'Application draft created');

  return v_application_id;
end;
$$;

revoke all on function public.create_application_draft(text) from public, anon;
grant execute on function public.create_application_draft(text) to authenticated;

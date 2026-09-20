-- A draft may be deliberately linked to a public program cycle at creation. This
-- is an owner choice, not an inferred institutional match or eligibility claim.
create or replace function public.create_application_draft(
  p_title text,
  p_program_cycle_id uuid,
  p_monitoring_enabled boolean
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_application_id uuid;
begin
  if v_owner_id is null then raise exception 'APPLICATION_AUTH_REQUIRED'; end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 or char_length(btrim(p_title)) > 200 then raise exception 'APPLICATION_TITLE_INVALID'; end if;
  if p_monitoring_enabled and p_program_cycle_id is null then raise exception 'APPLICATION_MONITORING_REQUIRES_PROGRAM_CYCLE'; end if;
  if p_program_cycle_id is not null and not exists (select 1 from public.program_cycles where id = p_program_cycle_id) then
    raise exception 'APPLICATION_PROGRAM_CYCLE_NOT_FOUND';
  end if;
  insert into public.applications (owner_id, title, program_cycle_id, monitoring_enabled)
    values (v_owner_id, btrim(p_title), p_program_cycle_id, coalesce(p_monitoring_enabled, false))
    returning id into v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
    values (v_owner_id, v_application_id, 1, 'owner', 'application_draft_created', 'application draft created',
      jsonb_build_object('programCycleId', p_program_cycle_id, 'monitoringEnabled', coalesce(p_monitoring_enabled, false)));
  return v_application_id;
end;
$$;

create or replace function public.create_application_draft(p_title text)
returns uuid language sql security definer set search_path = public, pg_temp as $$
  select public.create_application_draft(p_title, null, false);
$$;

revoke all on function public.create_application_draft(text, uuid, boolean) from public, anon;
grant execute on function public.create_application_draft(text, uuid, boolean) to authenticated;
revoke all on function public.create_application_draft(text) from public, anon;
grant execute on function public.create_application_draft(text) to authenticated;

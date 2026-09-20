-- Owner-recorded activities are explicit confirmations, not evidence of approval,
-- issuance, enrollment, eligibility, or covered monitoring.

create or replace function public.create_owner_tracked_activity(
  p_activity_type text,
  p_title text,
  p_scope_json jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_activity_id uuid;
  v_evidence_id uuid;
begin
  if v_owner_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_activity_type is null or char_length(btrim(p_activity_type)) not between 1 and 120 then
    raise exception 'ACTIVITY_TYPE_INVALID';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'ACTIVITY_TITLE_INVALID';
  end if;
  if p_scope_json is null or jsonb_typeof(p_scope_json) <> 'object' then
    raise exception 'ACTIVITY_SCOPE_INVALID';
  end if;

  perform 1 from public.profiles where user_id = v_owner_id for share;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  insert into public.tracked_activities (
    owner_id, activity_type, title, scope_json, confirmation_state, tracking_state
  ) values (
    v_owner_id, btrim(p_activity_type), btrim(p_title), p_scope_json, 'owner_confirmed', 'paused'
  ) returning id into v_activity_id;

  insert into public.activity_evidence (
    owner_id, activity_id, evidence_kind, supported_facts, confirmation_actor, confirmed_at
  ) values (
    v_owner_id, v_activity_id, 'owner_record', '{}'::jsonb, 'owner', now()
  ) returning id into v_evidence_id;

  insert into public.activity_fact_versions (
    owner_id, activity_id, fact_key, value_json, provenance_kind, source_activity_evidence_id, confirmation_state
  ) values (
    v_owner_id, v_activity_id, 'activity.title', to_jsonb(btrim(p_title)), 'owner_confirmation', null, 'confirmed'
  );

  return v_activity_id;
end;
$$;

revoke all on function public.create_owner_tracked_activity(text, text, jsonb) from public, anon;
grant execute on function public.create_owner_tracked_activity(text, text, jsonb) to authenticated;

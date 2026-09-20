-- Owner-controlled follow-up is intentionally narrow: it records an opt-in and
-- owner-provided reminder/action, then creates a linked private draft. It does
-- not invent source coverage, an open registration window, or eligibility.
create or replace function public.set_activity_followup_opt_in(
  p_activity_id uuid,
  p_enabled boolean
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_activity public.tracked_activities%rowtype;
begin
  if v_owner_id is null then raise exception 'ACTIVITY_AUTH_REQUIRED'; end if;
  select * into v_activity from public.tracked_activities where id = p_activity_id and owner_id = v_owner_id for update;
  if not found then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  if p_enabled and v_activity.confirmation_state not in ('owner_confirmed', 'evidence_supported') then
    raise exception 'ACTIVITY_CONFIRMATION_REQUIRED';
  end if;

  update public.tracked_activities
    set tracking_state = case when p_enabled then 'active'::public.activity_tracking_state else 'paused'::public.activity_tracking_state end
    where id = v_activity.id;
  insert into public.activity_subscriptions (owner_id, activity_id, enabled, explicit_opt_in_at, source_coverage_ids, started_at, stopped_at)
    values (v_owner_id, v_activity.id, p_enabled, now(), '[]'::jsonb, now(), case when p_enabled then null else now() end)
    on conflict (owner_id, activity_id) do update set enabled = excluded.enabled,
      explicit_opt_in_at = case when excluded.enabled then now() else activity_subscriptions.explicit_opt_in_at end,
      stopped_at = case when excluded.enabled then null else now() end;
  return p_enabled;
end;
$$;

create or replace function public.record_owner_followup_action(
  p_activity_id uuid,
  p_action_family_key text,
  p_action_period text,
  p_kind text,
  p_deadline_at timestamptz default null,
  p_deadline_text text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_action_id uuid;
begin
  if v_owner_id is null then raise exception 'ACTIVITY_AUTH_REQUIRED'; end if;
  if btrim(coalesce(p_action_family_key, '')) !~ '^[a-z][a-z0-9_.-]{0,119}$' then raise exception 'FOLLOWUP_ACTION_FAMILY_INVALID'; end if;
  if char_length(btrim(coalesce(p_action_period, ''))) not between 1 and 120 then raise exception 'FOLLOWUP_ACTION_PERIOD_INVALID'; end if;
  if char_length(btrim(coalesce(p_kind, ''))) not between 1 and 120 then raise exception 'FOLLOWUP_ACTION_KIND_INVALID'; end if;
  if char_length(coalesce(p_deadline_text, '')) > 500 then raise exception 'FOLLOWUP_ACTION_DEADLINE_TEXT_INVALID'; end if;
  if not exists (select 1 from public.tracked_activities where id = p_activity_id and owner_id = v_owner_id and tracking_state = 'active') then
    raise exception 'FOLLOWUP_OPT_IN_REQUIRED';
  end if;

  insert into public.followup_actions (
    owner_id, activity_id, action_family_key, action_period, trigger_kind,
    kind, applicability_result, cited_reason, deadline_at, deadline_text, state
  ) values (
    v_owner_id, p_activity_id, btrim(p_action_family_key), btrim(p_action_period), 'owner_reminder',
    btrim(p_kind), 'unknown', jsonb_build_object('basis', 'owner_recorded', 'message', 'This is an owner-recorded reminder/action, not a verified notice.'),
    p_deadline_at, nullif(btrim(p_deadline_text), ''), 'needs_clarification'
  ) on conflict (activity_id, action_family_key, action_period) do update set
    kind = excluded.kind, deadline_at = excluded.deadline_at, deadline_text = excluded.deadline_text,
    state = case when followup_actions.state in ('completed', 'dismissed', 'expired') then followup_actions.state else 'needs_clarification' end,
    updated_at = now(), row_version = followup_actions.row_version + 1
  returning id into v_action_id;
  return v_action_id;
end;
$$;

create or replace function public.prepare_followup_application(
  p_followup_action_id uuid,
  p_title text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_action public.followup_actions%rowtype;
  v_application_id uuid;
begin
  if v_owner_id is null then raise exception 'ACTIVITY_AUTH_REQUIRED'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200 then raise exception 'APPLICATION_TITLE_INVALID'; end if;
  select * into v_action from public.followup_actions where id = p_followup_action_id and owner_id = v_owner_id for update;
  if not found then raise exception 'FOLLOWUP_ACTION_NOT_FOUND'; end if;
  if v_action.state in ('dismissed', 'expired', 'completed', 'not_applicable') then raise exception 'FOLLOWUP_ACTION_NOT_PREPARABLE'; end if;
  if v_action.linked_application_id is not null then raise exception 'FOLLOWUP_APPLICATION_ALREADY_LINKED'; end if;

  insert into public.applications (owner_id, title, activity_id, followup_action_id)
    values (v_owner_id, btrim(p_title), v_action.activity_id, v_action.id)
    returning id into v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
    values (v_owner_id, v_application_id, 1, 'owner', 'followup_application_draft_created', 'linked follow-up application draft created', jsonb_build_object('activityId', v_action.activity_id, 'followupActionId', v_action.id));
  update public.followup_actions set linked_application_id = v_application_id, state = 'preparing', updated_at = now(), row_version = row_version + 1 where id = v_action.id;
  return v_application_id;
end;
$$;

revoke all on function public.set_activity_followup_opt_in(uuid, boolean) from public, anon;
grant execute on function public.set_activity_followup_opt_in(uuid, boolean) to authenticated;
revoke all on function public.record_owner_followup_action(uuid, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.record_owner_followup_action(uuid, text, text, text, timestamptz, text) to authenticated;
revoke all on function public.prepare_followup_application(uuid, text) from public, anon;
grant execute on function public.prepare_followup_application(uuid, text) to authenticated;

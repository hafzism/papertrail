-- Keep an already-known scope mismatch out of clarification alerts, and permit
-- corrected owner scope to make a previously non-applicable action relevant.
create or replace function public.evaluate_activity_followup_rules(p_activity_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_activity public.tracked_activities%rowtype;v_rule record;v_action uuid;v_missing jsonb;v_match boolean;v_linked uuid;
begin
  select a.* into v_activity from public.tracked_activities a join public.activity_subscriptions s on s.owner_id=a.owner_id and s.activity_id=a.id and s.enabled where a.id=p_activity_id and a.tracking_state='active' and a.confirmation_state in('owner_confirmed','evidence_supported') for update of a;
  if not found then return;end if;
  for v_rule in select distinct on(action_family_key,action_period) * from public.published_followup_rules where program_id=v_activity.program_id and activity_type=v_activity.activity_type order by action_family_key,action_period,created_at desc,id desc loop
    select coalesce(jsonb_agg(key),'[]'::jsonb) into v_missing from jsonb_object_keys(v_rule.scope_filter) key where not v_activity.scope_json ? key;
    v_match:=v_activity.scope_json @> v_rule.scope_filter;
    if exists(select 1 from jsonb_each(v_rule.scope_filter) entry where v_activity.scope_json ? entry.key and v_activity.scope_json->entry.key is distinct from entry.value) then
      update public.followup_actions set applicability_result='not_applicable',state=case when state in('completed','submitted')then state else 'not_applicable'::public.followup_action_state end
        where owner_id=v_activity.owner_id and activity_id=v_activity.id and action_family_key=v_rule.action_family_key and action_period=v_rule.action_period and applicability_result<>'not_applicable' returning linked_application_id into v_linked;
      if v_linked is not null then perform public.advance_application_material(v_activity.owner_id,v_linked,'requirement');end if;
      continue;
    end if;
    insert into public.followup_actions(owner_id,activity_id,action_family_key,action_period,current_notice_version_id,trigger_kind,kind,applicability_result,cited_reason,deadline_at,deadline_text,state)
      values(v_activity.owner_id,v_activity.id,v_rule.action_family_key,v_rule.action_period,v_rule.revision_id,'verified_notice',v_rule.kind,case when v_match then 'pass' else 'unknown' end,jsonb_build_object('ruleId',v_rule.id,'citation',v_rule.citation_excerpt,'missingScopeFields',v_missing,'basis','moderator_reviewed_notice'),v_rule.deadline_at,v_rule.deadline_text,case when v_match then 'available'::public.followup_action_state else 'needs_clarification'::public.followup_action_state end)
      on conflict(activity_id,action_family_key,action_period) do update set current_notice_version_id=excluded.current_notice_version_id,kind=excluded.kind,applicability_result=excluded.applicability_result,cited_reason=excluded.cited_reason,deadline_at=excluded.deadline_at,deadline_text=excluded.deadline_text,
        state=case when followup_actions.state in('completed','dismissed','submitted') then followup_actions.state when followup_actions.linked_application_id is not null then 'awaiting_review'::public.followup_action_state else excluded.state end
      where followup_actions.cited_reason is distinct from excluded.cited_reason or followup_actions.deadline_at is distinct from excluded.deadline_at or followup_actions.deadline_text is distinct from excluded.deadline_text
      returning id,linked_application_id into v_action,v_linked;
    if v_action is not null then
      if v_linked is not null then perform public.advance_application_material(v_activity.owner_id,v_linked,'requirement');end if;
      insert into public.notifications(owner_id,activity_id,followup_action_id,event_type,dedupe_key,minimal_text,deep_link,actionable_status)
        values(v_activity.owner_id,v_activity.id,v_action,'verified_followup_action','followup-rule:'||v_rule.id||':'||v_activity.id,case when v_match then 'A reviewed notice contains a next action for this tracked activity.' else 'A reviewed notice may apply. Confirm the missing activity details before acting.' end,'/app/activities/'||v_activity.id,'needs_review')on conflict(owner_id,dedupe_key)do nothing;
    end if;
  end loop;
end;$$;


create or replace function public.configure_activity_notice_scope(p_activity_id uuid,p_program_id uuid,p_scope jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old_program uuid;v_linked uuid;
begin
  select program_id into v_old_program from public.tracked_activities where id=p_activity_id and owner_id=auth.uid() for update;
  if jsonb_typeof(p_scope)<>'object' or exists(select 1 from jsonb_each(p_scope) where key!~'^[a-z][a-z0-9_.-]{0,119}$' or jsonb_typeof(value)not in('string','number','boolean'))then raise exception 'ACTIVITY_SCOPE_INVALID';end if;
  if not exists(select 1 from public.programs where id=p_program_id)then raise exception 'PROGRAM_NOT_FOUND';end if;
  update public.tracked_activities set program_id=p_program_id,scope_json=p_scope where id=p_activity_id and owner_id=auth.uid() and confirmation_state in('owner_confirmed','evidence_supported') and tracking_state<>'ended';
  if not found then raise exception 'CONFIRMED_ACTIVITY_REQUIRED';end if;
  update public.activity_subscriptions set source_coverage_ids=coalesce((select jsonb_agg(id)from public.published_program_sources where program_id=p_program_id),'[]'::jsonb)where activity_id=p_activity_id and owner_id=auth.uid();
  if v_old_program is distinct from p_program_id then
    for v_linked in update public.followup_actions set state='not_applicable',applicability_result='not_applicable'
      where owner_id=auth.uid() and activity_id=p_activity_id and trigger_kind='verified_notice' and state not in('completed','dismissed','submitted') returning linked_application_id loop
      if v_linked is not null then perform public.advance_application_material(auth.uid(),v_linked,'requirement');end if;
    end loop;
  end if;
  perform public.evaluate_activity_followup_rules(p_activity_id);return true;
end;$$;

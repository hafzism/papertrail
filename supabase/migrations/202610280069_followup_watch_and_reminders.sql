-- Typed moderator-reviewed follow-up rules reuse the existing activity/action model.
create table public.published_followup_rules(
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.published_notice_revisions(id),
  program_id uuid not null references public.programs(id),
  activity_type text not null check(char_length(activity_type) between 1 and 120),
  scope_filter jsonb not null check(jsonb_typeof(scope_filter)='object'),
  action_family_key text not null check(action_family_key ~ '^[a-z][a-z0-9_.-]{0,119}$'),
  action_period text not null check(char_length(action_period) between 1 and 120),
  kind text not null check(char_length(kind) between 1 and 120),
  citation_excerpt text not null check(char_length(citation_excerpt) between 1 and 4000),
  deadline_at timestamptz,
  deadline_text text,
  created_at timestamptz not null default now(),
  unique(revision_id,action_family_key,action_period)
);
alter table public.published_followup_rules enable row level security;
create policy published_followup_rules_read on public.published_followup_rules for select using(true);
revoke all on public.published_followup_rules from public,anon,authenticated;
grant select on public.published_followup_rules to authenticated;

create or replace function public.evaluate_activity_followup_rules(p_activity_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_activity public.tracked_activities%rowtype;v_rule record;v_action uuid;v_missing jsonb;v_match boolean;v_linked uuid;
begin
  select a.* into v_activity from public.tracked_activities a join public.activity_subscriptions s on s.owner_id=a.owner_id and s.activity_id=a.id and s.enabled where a.id=p_activity_id and a.tracking_state='active' and a.confirmation_state in('owner_confirmed','evidence_supported') for update of a;
  if not found then return;end if;
  for v_rule in select distinct on(action_family_key,action_period) * from public.published_followup_rules where program_id=v_activity.program_id and activity_type=v_activity.activity_type order by action_family_key,action_period,created_at desc,id desc loop
    select coalesce(jsonb_agg(key),'[]'::jsonb) into v_missing from jsonb_object_keys(v_rule.scope_filter) key where not v_activity.scope_json ? key;
    v_match:=v_activity.scope_json @> v_rule.scope_filter;
    if not v_match and jsonb_array_length(v_missing)=0 then
      update public.followup_actions set applicability_result='not_applicable',state=case when state in('completed','submitted')then state else 'not_applicable'::public.followup_action_state end
        where owner_id=v_activity.owner_id and activity_id=v_activity.id and action_family_key=v_rule.action_family_key and action_period=v_rule.action_period and applicability_result<>'not_applicable' returning linked_application_id into v_linked;
      if v_linked is not null then perform public.advance_application_material(v_activity.owner_id,v_linked,'requirement');end if;
      continue;
    end if;
    insert into public.followup_actions(owner_id,activity_id,action_family_key,action_period,current_notice_version_id,trigger_kind,kind,applicability_result,cited_reason,deadline_at,deadline_text,state)
      values(v_activity.owner_id,v_activity.id,v_rule.action_family_key,v_rule.action_period,v_rule.revision_id,'verified_notice',v_rule.kind,case when v_match then 'pass' else 'unknown' end,jsonb_build_object('ruleId',v_rule.id,'citation',v_rule.citation_excerpt,'missingScopeFields',v_missing,'basis','moderator_reviewed_notice'),v_rule.deadline_at,v_rule.deadline_text,case when v_match then 'available'::public.followup_action_state else 'needs_clarification'::public.followup_action_state end)
      on conflict(activity_id,action_family_key,action_period) do update set current_notice_version_id=excluded.current_notice_version_id,kind=excluded.kind,applicability_result=excluded.applicability_result,cited_reason=excluded.cited_reason,deadline_at=excluded.deadline_at,deadline_text=excluded.deadline_text,
        state=case when followup_actions.state in('completed','dismissed','submitted','not_applicable') then followup_actions.state when followup_actions.linked_application_id is not null then 'awaiting_review'::public.followup_action_state else excluded.state end
      where followup_actions.cited_reason is distinct from excluded.cited_reason or followup_actions.deadline_at is distinct from excluded.deadline_at
      returning id,linked_application_id into v_action,v_linked;
    if v_action is not null then
      if v_linked is not null then perform public.advance_application_material(v_activity.owner_id,v_linked,'requirement');end if;
      insert into public.notifications(owner_id,activity_id,followup_action_id,event_type,dedupe_key,minimal_text,deep_link,actionable_status)
        values(v_activity.owner_id,v_activity.id,v_action,'verified_followup_action','followup-rule:'||v_rule.id||':'||v_activity.id,case when v_match then 'A reviewed notice contains a next action for this tracked activity.' else 'A reviewed notice may apply. Confirm the missing activity details before acting.' end,'/app/activities/'||v_activity.id,'needs_review')on conflict(owner_id,dedupe_key)do nothing;
    end if;
  end loop;
end;$$;

create or replace function public.publish_followup_rule(p_revision_id uuid,p_activity_type text,p_scope jsonb,p_family text,p_period text,p_kind text,p_citation text,p_deadline_at timestamptz default null,p_deadline_text text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_program uuid;v_rule uuid;v_activity uuid;
begin
  if not public.is_notice_moderator()then raise exception 'MODERATOR_REQUIRED';end if;
  select program_id into v_program from public.published_notice_revisions where id=p_revision_id;
  if not found then raise exception 'PUBLISHED_REVISION_REQUIRED';end if;
  if jsonb_typeof(p_scope)<>'object' or exists(select 1 from jsonb_each(p_scope) where key!~'^[a-z][a-z0-9_.-]{0,119}$' or jsonb_typeof(value)not in('string','number','boolean'))then raise exception 'FOLLOWUP_SCOPE_INVALID';end if;
  insert into public.published_followup_rules(revision_id,program_id,activity_type,scope_filter,action_family_key,action_period,kind,citation_excerpt,deadline_at,deadline_text)values(p_revision_id,v_program,p_activity_type,p_scope,p_family,p_period,p_kind,p_citation,p_deadline_at,p_deadline_text)returning id into v_rule;
  for v_activity in select id from public.tracked_activities where program_id=v_program and tracking_state='active' order by id loop perform public.evaluate_activity_followup_rules(v_activity);end loop;
  return v_rule;
end;$$;

create or replace function public.configure_activity_notice_scope(p_activity_id uuid,p_program_id uuid,p_scope jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if jsonb_typeof(p_scope)<>'object' or exists(select 1 from jsonb_each(p_scope) where key!~'^[a-z][a-z0-9_.-]{0,119}$' or jsonb_typeof(value)not in('string','number','boolean'))then raise exception 'ACTIVITY_SCOPE_INVALID';end if;
  if not exists(select 1 from public.programs where id=p_program_id)then raise exception 'PROGRAM_NOT_FOUND';end if;
  update public.tracked_activities set program_id=p_program_id,scope_json=p_scope where id=p_activity_id and owner_id=auth.uid() and confirmation_state in('owner_confirmed','evidence_supported') and tracking_state<>'ended';
  if not found then raise exception 'CONFIRMED_ACTIVITY_REQUIRED';end if;
  update public.activity_subscriptions set source_coverage_ids=coalesce((select jsonb_agg(id)from public.published_program_sources where program_id=p_program_id),'[]'::jsonb)where activity_id=p_activity_id and owner_id=auth.uid();
  perform public.evaluate_activity_followup_rules(p_activity_id);return true;
end;$$;

create or replace function public.evaluate_activity_after_optin()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if new.enabled then perform public.evaluate_activity_followup_rules(new.activity_id);end if;return new;end;$$;
create trigger activity_evaluate_on_optin after insert or update of enabled on public.activity_subscriptions for each row execute function public.evaluate_activity_after_optin();

-- Owner-recorded reminders also require an explicit provenance record.
create or replace function public.ensure_owner_reminder_provenance()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.trigger_kind='owner_reminder' and new.trigger_evidence_version_id is null then
    insert into public.activity_evidence(owner_id,activity_id,evidence_kind,supported_facts,confirmation_actor,confirmed_at)
      values(new.owner_id,new.activity_id,'owner_record',jsonb_build_object('instruction',new.kind,'deadlineAt',new.deadline_at,'deadlineText',new.deadline_text),'owner',now())returning id into new.trigger_evidence_version_id;
  end if;return new;
end;$$;
create trigger followup_owner_reminder_provenance before insert on public.followup_actions for each row execute function public.ensure_owner_reminder_provenance();

create table public.followup_reminder_log(action_id uuid not null references public.followup_actions(id)on delete cascade,deadline_at timestamptz not null,offset_days integer not null,created_at timestamptz not null default now(),primary key(action_id,deadline_at,offset_days));
alter table public.followup_reminder_log enable row level security;
revoke all on public.followup_reminder_log from public,anon,authenticated;

create or replace function public.enqueue_due_followup_reminders()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action record;v_offset integer;v_count integer:=0;v_notification uuid;v_send_after timestamptz;v_local timestamp:=now()at time zone 'Asia/Kolkata';
begin
  for v_action in select f.* from public.followup_actions f join public.tracked_activities a on a.id=f.activity_id and a.owner_id=f.owner_id join public.activity_subscriptions s on s.activity_id=a.id and s.owner_id=a.owner_id where a.tracking_state='active'and s.enabled and f.deadline_at>now()and f.state not in('completed','dismissed','expired','not_applicable','submitted')loop
    -- Only the most recent reminder window is sent when older windows are past.
    v_offset:=case when v_action.deadline_at-now()<=interval '1 day' then 1 when v_action.deadline_at-now()<=interval '3 days' then 3 when v_action.deadline_at-now()<=interval '7 days' then 7 else null end;
    if v_offset is null or extract(hour from v_local)<9 then continue;end if;
    insert into public.followup_reminder_log(action_id,deadline_at,offset_days)values(v_action.id,v_action.deadline_at,v_offset)on conflict do nothing;
    if not found then continue;end if;
    insert into public.notifications(owner_id,activity_id,followup_action_id,event_type,dedupe_key,minimal_text,deep_link,actionable_status)values(v_action.owner_id,v_action.activity_id,v_action.id,'followup_deadline_reminder','followup-deadline:'||v_action.id||':'||v_action.deadline_at::text||':'||v_offset,'A recorded deadline is approaching. Review this tracked activity.','/app/activities/'||v_action.activity_id,'needs_review')returning id into v_notification;
    if extract(hour from v_local)>=22 then
      v_send_after:=((v_local::date+1)+time '08:00')at time zone 'Asia/Kolkata';
      update public.jobs set not_before=v_send_after where kind='deliver_telegram_notification' and payload->>'notificationId'=v_notification::text and state='queued';
    end if;
    v_count:=v_count+1;
  end loop;return v_count;
end;$$;

revoke all on function public.publish_followup_rule(uuid,text,jsonb,text,text,text,text,timestamptz,text),public.configure_activity_notice_scope(uuid,uuid,jsonb)from public,anon;
grant execute on function public.publish_followup_rule(uuid,text,jsonb,text,text,text,text,timestamptz,text),public.configure_activity_notice_scope(uuid,uuid,jsonb)to authenticated;
revoke all on function public.evaluate_activity_followup_rules(uuid),public.evaluate_activity_after_optin(),public.ensure_owner_reminder_provenance(),public.enqueue_due_followup_reminders()from public,anon,authenticated;
grant execute on function public.enqueue_due_followup_reminders()to service_role,postgres;

alter table public.followup_actions drop constraint followup_actions_owner_id_linked_application_id_fkey;
alter table public.followup_actions add constraint followup_actions_owner_id_linked_application_id_fkey foreign key(owner_id,linked_application_id)references public.applications(owner_id,id)on delete set null(linked_application_id);
alter table public.applications drop constraint applications_activity_owner_fk;
alter table public.applications add constraint applications_activity_owner_fk foreign key(owner_id,activity_id)references public.tracked_activities(owner_id,id)on delete set null(activity_id);
alter table public.applications drop constraint applications_followup_action_owner_fk;
alter table public.applications add constraint applications_followup_action_owner_fk foreign key(owner_id,followup_action_id)references public.followup_actions(owner_id,id)on delete set null(followup_action_id);

create or replace function public.begin_telegram_notification_delivery(p_job_id uuid,p_fencing_token bigint,p_owner_id uuid,p_delivery_id uuid)
returns table(telegram_chat_id bigint,deep_link text)language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return query update public.telegram_notification_deliveries d set state='sending',attempts=d.attempts+1,last_error_code=null
    from public.notifications n,public.jobs j,public.telegram_channel_links c
    where d.id=p_delivery_id and d.owner_id=p_owner_id and d.notification_id=n.id and j.id=p_job_id and j.owner_id=p_owner_id and j.kind='deliver_telegram_notification'and j.state='running'and j.fencing_token=p_fencing_token and j.lease_expires_at>now()
      and c.owner_id=p_owner_id and c.telegram_chat_id=d.telegram_chat_id and c.unlinked_at is null and d.state='queued'
      and (n.event_type not in('followup_deadline_reminder','verified_followup_action')or exists(select 1 from public.tracked_activities a join public.activity_subscriptions s on s.owner_id=a.owner_id and s.activity_id=a.id where a.id=n.activity_id and a.owner_id=p_owner_id and a.tracking_state='active'and s.enabled))
      and (n.event_type<>'followup_deadline_reminder'or exists(select 1 from public.followup_actions f where f.id=n.followup_action_id and f.owner_id=p_owner_id and f.state not in('completed','dismissed','expired','not_applicable','submitted')and n.dedupe_key like 'followup-deadline:'||f.id||':'||f.deadline_at::text||':%'))
    returning d.telegram_chat_id,n.deep_link;
end;$$;

-- Web, recorded voice and live voice share the same owner-scoped application context.
create table public.application_assistant_turns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  request_id uuid not null,
  material_version bigint not null,
  message text not null check (char_length(message) between 1 and 4000),
  reply text,
  state text not null default 'pending' check (state in ('pending', 'running', 'completed', 'failed', 'obsolete')),
  created_at timestamptz not null default now(),
  unique(owner_id, request_id),
  foreign key(owner_id, application_id) references public.applications(owner_id,id) on delete cascade
);
alter table public.application_assistant_turns enable row level security;
create policy assistant_turns_owner_read on public.application_assistant_turns for select using (owner_id=auth.uid());
revoke all on public.application_assistant_turns from public, anon, authenticated;
grant select on public.application_assistant_turns to authenticated;
create index assistant_turns_application_created on public.application_assistant_turns(owner_id,application_id,created_at desc);

create or replace function public.application_assistant_context(p_application_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid:=auth.uid(); v_application jsonb; v_context jsonb;
begin
  select jsonb_build_object('id',id,'title',title,'lifecycle',lifecycle_state,'readiness',readiness_state,'materialVersion',material_version)
    into v_application from public.applications where id=p_application_id and owner_id=v_owner;
  if v_application is null then raise exception 'APPLICATION_NOT_FOUND'; end if;
  select jsonb_build_object(
    'application',v_application,
    'requirements',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,label,kind,citation_excerpt,review_state from public.private_requirement_versions where owner_id=v_owner and application_id=p_application_id order by created_at desc limit 30) r),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(to_jsonb(s)) from (select id,source_kind,source_status,left(captured_text,2500) as text from public.private_notice_snapshots where owner_id=v_owner and application_id=p_application_id order by created_at desc limit 5) s),'[]'::jsonb),
    'profileFacts',coalesce((select jsonb_agg(to_jsonb(f)) from (select distinct on(fact_key) fact_key,value_json,confirmation_state from public.profile_fact_versions where owner_id=v_owner order by fact_key,created_at desc,id desc limit 40) f),'[]'::jsonb),
    'applicationFacts',coalesce((select jsonb_agg(to_jsonb(f)) from (select distinct on(fact_key) fact_key,value_json from public.application_fact_overrides where owner_id=v_owner and application_id=p_application_id order by fact_key,created_at desc,id desc limit 40) f),'[]'::jsonb),
    'evidenceBindings',coalesce((select jsonb_agg(to_jsonb(b)) from (select private_requirement_id,document_version_id,binding_state from public.evidence_bindings where owner_id=v_owner and application_id=p_application_id limit 40) b),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(to_jsonb(d)) from (select d.id,d.label,v.id as version_id,v.extraction_state from public.documents d join public.document_versions v on v.id=d.latest_version_id and v.owner_id=d.owner_id where d.owner_id=v_owner and d.deleted_at is null order by d.created_at desc limit 30) d),'[]'::jsonb),
    'recentConversation',coalesce((select jsonb_agg(to_jsonb(t)) from (select message,reply from public.application_assistant_turns where owner_id=v_owner and application_id=p_application_id and state='completed' order by created_at desc limit 6) t),'[]'::jsonb)
  ) into v_context;
  return v_context;
end; $$;

create or replace function public.begin_application_assistant_turn(p_application_id uuid,p_message text,p_request_id uuid)
returns public.application_assistant_turns language plpgsql security definer set search_path=public,pg_temp as $$
declare v_app public.applications%rowtype; v_turn public.application_assistant_turns%rowtype;
begin
  select * into v_app from public.applications where id=p_application_id and owner_id=auth.uid() for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  select * into v_turn from public.application_assistant_turns where owner_id=auth.uid() and request_id=p_request_id;
  if found then
    if v_turn.application_id<>p_application_id or v_turn.message<>btrim(p_message) then raise exception 'REQUEST_CONFLICT'; end if;
    return v_turn;
  end if;
  if exists(select 1 from public.application_assistant_turns where owner_id=auth.uid() and state in ('pending','running') and created_at>now()-interval '2 minutes') then raise exception 'ASSISTANT_BUSY'; end if;
  insert into public.application_assistant_turns(owner_id,application_id,request_id,material_version,message)
    values(auth.uid(),p_application_id,p_request_id,v_app.material_version,btrim(p_message)) returning * into v_turn;
  return v_turn;
end; $$;

create or replace function public.claim_application_assistant_turn(p_owner_id uuid,p_turn_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.application_assistant_turns set state='running' where id=p_turn_id and owner_id=p_owner_id and state='pending';
  return found;
end; $$;

create or replace function public.finish_application_assistant_turn(p_owner_id uuid,p_turn_id uuid,p_reply text,p_failed boolean default false)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state text;
begin
  update public.application_assistant_turns t set
    state=case when p_failed then 'failed' when a.material_version<>t.material_version then 'obsolete' else 'completed' end,
    reply=left(p_reply,8000)
    from public.applications a where t.id=p_turn_id and t.owner_id=p_owner_id and a.owner_id=t.owner_id and a.id=t.application_id and t.state='running'
    returning t.state into v_state;
  return v_state;
end; $$;

create table public.voice_tool_results (
  session_id uuid not null references public.voice_sessions(id) on delete cascade,
  task_id text not null check(char_length(task_id) between 1 and 160),
  tool_name text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(session_id,task_id)
);
alter table public.voice_tool_results enable row level security;
revoke all on public.voice_tool_results from public,anon,authenticated;

create or replace function public.run_voice_application_tool(p_session_id uuid,p_task_id text,p_tool text,p_arguments jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.voice_sessions%rowtype; v_result jsonb; v_snapshot uuid;
begin
  select * into v_session from public.voice_sessions where id=p_session_id and owner_id=auth.uid() and state='connected' and expires_at>now() for update;
  if not found then raise exception 'VOICE_SESSION_NOT_ACTIVE'; end if;
  select result into v_result from public.voice_tool_results where session_id=p_session_id and task_id=p_task_id;
  if found then return v_result; end if;
  if p_tool='get_application_state' then
    v_result:=public.application_assistant_context(v_session.application_id);
  elsif p_tool='prepare_packet' then
    select to_jsonb(r) into v_result from public.request_private_packet_manifest(v_session.application_id) r;
  elsif p_tool='analyze_source' then
    v_snapshot:=(p_arguments->>'sourceId')::uuid;
    select to_jsonb(r) into v_result from public.request_private_requirement_proposal(v_session.application_id,v_snapshot) r;
  elsif p_tool='save_application_note' then
    v_result:=jsonb_build_object('noteId',public.add_application_note(v_session.application_id,p_arguments->>'text'));
  else raise exception 'VOICE_TOOL_UNSUPPORTED';
  end if;
  insert into public.voice_tool_results(session_id,task_id,tool_name,result) values(p_session_id,p_task_id,p_tool,coalesce(v_result,'{}'::jsonb));
  return v_result;
end; $$;

revoke all on function public.application_assistant_context(uuid) from public,anon;
revoke all on function public.begin_application_assistant_turn(uuid,text,uuid) from public,anon;
revoke all on function public.finish_application_assistant_turn(uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.claim_application_assistant_turn(uuid,uuid) from public,anon,authenticated;
revoke all on function public.run_voice_application_tool(uuid,text,text,jsonb) from public,anon;
grant execute on function public.application_assistant_context(uuid),public.begin_application_assistant_turn(uuid,text,uuid),public.run_voice_application_tool(uuid,text,text,jsonb) to authenticated;
grant execute on function public.finish_application_assistant_turn(uuid,uuid,text,boolean) to service_role,postgres;
grant execute on function public.claim_application_assistant_turn(uuid,uuid) to service_role,postgres;

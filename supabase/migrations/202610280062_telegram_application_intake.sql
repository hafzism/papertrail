alter table public.telegram_channel_links add column selected_application_id uuid;
alter table public.telegram_channel_links add constraint telegram_selected_application_owner_fk foreign key(owner_id,selected_application_id) references public.applications(owner_id,id);

create table public.telegram_intake_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  telegram_update_id bigint not null unique,
  telegram_chat_id bigint not null,
  application_id uuid,
  body text not null default '' check(char_length(body)<=4000),
  media jsonb,
  state text not null default 'queued' check(state in ('queued','processing','completed','failed','uncertain')),
  result jsonb,
  created_at timestamptz not null default now(),
  foreign key(owner_id,application_id) references public.applications(owner_id,id)
);
alter table public.telegram_intake_requests enable row level security;
create policy telegram_intake_owner_read on public.telegram_intake_requests for select using(owner_id=auth.uid());
revoke all on public.telegram_intake_requests from public,anon,authenticated;
grant select on public.telegram_intake_requests to authenticated;

create or replace function public.queue_telegram_intake(p_update_id bigint,p_chat_id bigint,p_chat_type text,p_body text,p_media jsonb default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_link public.telegram_channel_links%rowtype; v_id uuid;
begin
  if p_chat_type<>'private' then return 'group_rejected'; end if;
  select * into v_link from public.telegram_channel_links where telegram_chat_id=p_chat_id and unlinked_at is null for update;
  if not found then return 'unlinked'; end if;
  insert into public.telegram_inbound_updates(telegram_update_id,chat_id,update_kind,outcome_code)
    values(p_update_id,p_chat_id,'application_intake','QUEUED') on conflict(telegram_update_id) do nothing;
  if not found then return 'duplicate'; end if;
  if (select count(*) from public.telegram_intake_requests where owner_id=v_link.owner_id and created_at>now()-interval '1 minute')>=20 then return 'rate_limited'; end if;
  insert into public.telegram_intake_requests(owner_id,telegram_update_id,telegram_chat_id,application_id,body,media)
    values(v_link.owner_id,p_update_id,p_chat_id,v_link.selected_application_id,left(coalesce(p_body,''),4000),p_media) returning id into v_id;
  insert into public.jobs(kind,owner_id,dedupe_key,payload) values('process_telegram_intake',v_link.owner_id,'telegram-intake:'||v_id,jsonb_build_object('intakeId',v_id));
  return 'queued';
end; $$;

create or replace function public.telegram_intake_action(p_job_id uuid,p_fencing_token bigint,p_action text,p_arguments jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_job public.jobs%rowtype; v_req public.telegram_intake_requests%rowtype; v_link public.telegram_channel_links%rowtype;
  v_result jsonb; v_app uuid; v_doc uuid; v_version uuid; v_path text; v_generation integer;
begin
  select * into v_job from public.jobs where id=p_job_id and kind='process_telegram_intake' and state='running' and fencing_token=p_fencing_token and lease_expires_at>now() for update;
  if not found then raise exception 'TELEGRAM_JOB_FENCE_REJECTED'; end if;
  select * into v_req from public.telegram_intake_requests where id=(v_job.payload->>'intakeId')::uuid and owner_id=v_job.owner_id for update;
  if not found then raise exception 'TELEGRAM_INTAKE_NOT_FOUND'; end if;
  select * into v_link from public.telegram_channel_links where owner_id=v_req.owner_id and telegram_chat_id=v_req.telegram_chat_id and unlinked_at is null for update;
  if not found then raise exception 'TELEGRAM_LINK_REVOKED'; end if;
  perform set_config('request.jwt.claim.sub',v_req.owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_req.owner_id,'role','authenticated')::text,true);
  if p_action='begin' then
    if v_req.state='processing' then return jsonb_build_object('uncertain',true); end if;
    if v_req.state<>'queued' then return jsonb_build_object('finished',true); end if;
    update public.telegram_intake_requests set state='processing' where id=v_req.id;
    return to_jsonb(v_req);
  elsif p_action='applications' then
    return coalesce((select jsonb_agg(to_jsonb(a)) from (select id,title,lifecycle_state from public.applications where owner_id=v_req.owner_id order by created_at limit 40) a),'[]'::jsonb);
  elsif p_action='select' then
    v_app:=(p_arguments->>'applicationId')::uuid;
    if not exists(select 1 from public.applications where owner_id=v_req.owner_id and id=v_app) then raise exception 'APPLICATION_NOT_FOUND'; end if;
    update public.telegram_channel_links set selected_application_id=v_app where id=v_link.id;
    return jsonb_build_object('applicationId',v_app);
  elsif p_action='new' then
    v_app:=public.create_application_draft(p_arguments->>'title');
    update public.telegram_channel_links set selected_application_id=v_app where id=v_link.id;
    return jsonb_build_object('applicationId',v_app);
  elsif p_action='context' then
    return public.application_assistant_context(v_req.application_id);
  elsif p_action='note' then
    return jsonb_build_object('noteId',public.add_application_note(v_req.application_id,p_arguments->>'text'));
  elsif p_action='source' then
    return jsonb_build_object('sourceId',public.add_application_text_description(v_req.application_id,p_arguments->>'text'));
  elsif p_action='packet' then
    select to_jsonb(r) into v_result from public.request_private_packet_manifest(v_req.application_id) r;
    return v_result;
  elsif p_action='document' then
    if v_req.result->>'documentVersionId' is not null then return v_req.result; end if;
    v_path:=p_arguments->>'objectPath';
    if v_path not like 'telegram/'||v_req.owner_id::text||'/'||v_req.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='private-documents' and name=v_path) then raise exception 'TELEGRAM_STORAGE_SCOPE_INVALID'; end if;
    if (p_arguments->>'mimeType') not in ('application/pdf','image/jpeg','image/png','image/webp') or (p_arguments->>'byteSize')::bigint not between 1 and 20971520 or (p_arguments->>'sha256') !~ '^[a-f0-9]{64}$' then raise exception 'TELEGRAM_DOCUMENT_INVALID'; end if;
    select deletion_generation into v_generation from public.profiles where user_id=v_req.owner_id for share;
    insert into public.documents(owner_id,label,document_type) values(v_req.owner_id,left(p_arguments->>'filename',200),'Telegram upload') returning id into v_doc;
    insert into public.document_versions(owner_id,document_id,object_path,sha256,original_filename,mime_type,byte_size)
      values(v_req.owner_id,v_doc,v_path,p_arguments->>'sha256',p_arguments->>'filename',p_arguments->>'mimeType',(p_arguments->>'byteSize')::bigint) returning id into v_version;
    update public.documents set latest_version_id=v_version where id=v_doc;
    insert into public.jobs(kind,owner_id,dedupe_key,payload) values('extract_document',v_req.owner_id,'extract-document:'||v_version,jsonb_build_object('documentVersionId',v_version,'deletionGeneration',v_generation));
    v_result:=jsonb_build_object('documentVersionId',v_version);
    update public.telegram_intake_requests set result=v_result where id=v_req.id;
    return v_result;
  elsif p_action='transcript' then
    if v_req.result->>'transcript' is not null then return v_req.result; end if;
    insert into public.telegram_inbound_messages(owner_id,telegram_update_id,telegram_chat_id,body) values(v_req.owner_id,v_req.telegram_update_id,v_req.telegram_chat_id,left(p_arguments->>'text',4000)) on conflict(telegram_update_id) do nothing;
    v_result:=jsonb_build_object('transcript',left(p_arguments->>'text',4000));
    update public.telegram_intake_requests set result=v_result where id=v_req.id;
    return v_result;
  elsif p_action='finish' then
    update public.telegram_intake_requests set state=coalesce(p_arguments->>'state','completed'),result=coalesce(result,'{}'::jsonb)||p_arguments where id=v_req.id;
    update public.telegram_inbound_updates set handled_at=now(),outcome_code='HANDLED' where telegram_update_id=v_req.telegram_update_id;
    return '{}'::jsonb;
  elsif p_action='unlink' then
    update public.telegram_channel_links set unlinked_at=now(),selected_application_id=null where id=v_link.id;
    return '{}'::jsonb;
  else raise exception 'TELEGRAM_ACTION_UNSUPPORTED'; end if;
end; $$;

revoke all on function public.queue_telegram_intake(bigint,bigint,text,text,jsonb),public.telegram_intake_action(uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.queue_telegram_intake(bigint,bigint,text,text,jsonb),public.telegram_intake_action(uuid,bigint,text,jsonb) to service_role,postgres;

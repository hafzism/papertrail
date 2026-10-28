create table public.browser_executions(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  changeset_id uuid not null unique references public.changesets(id) on delete cascade,
  gateway_session_id uuid,
  creation_claimed boolean not null default false,
  state text not null default 'starting' check(state in ('starting','ready','human_control','dispatching','outcome_unknown','completed','failed','closed')),
  observation jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  foreign key(owner_id,application_id) references public.applications(owner_id,id) on delete cascade
);
alter table public.browser_executions enable row level security;
create policy browser_executions_owner_read on public.browser_executions for select using(owner_id=auth.uid());
revoke all on public.browser_executions from public,anon,authenticated;
grant select on public.browser_executions to authenticated;
grant all on public.browser_executions to service_role;

create or replace function public.create_reference_browser_review(p_application_id uuid,p_origin text,p_fields jsonb,p_document_ids uuid[])
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_payload jsonb;v_id uuid;v_attachments jsonb;v_version bigint;v_kind text:=p_fields->>'kind';
begin
  select material_version into v_version from public.applications where id=p_application_id and owner_id=auth.uid() and lifecycle_state in ('draft','prepared') for update;
  if not found then raise exception 'APPLICATION_NOT_REVIEWABLE';end if;
  if p_origin !~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' then raise exception 'PORTAL_ORIGIN_INVALID';end if;
  if p_fields-array['name','applicantType','kind','centre','course','location','session']<>'{}'::jsonb or char_length(btrim(p_fields->>'name')) not between 1 and 200 or p_fields->>'applicantType' not in ('student','community-member') or v_kind not in ('grant','exam','renewal') then raise exception 'PORTAL_FIELDS_INVALID';end if;
  if v_kind='exam' and (p_fields->>'centre' not in ('Riverbank Centre','Hillview Centre') or p_fields->>'course' not in ('DEMO101','DEMO102') or p_fields->>'session'<>'DEMO-2026-A') then raise exception 'EXAM_SELECTION_REQUIRED';end if;
  if v_kind='renewal' and p_fields->>'location' not in ('Central Community Hall','Westside Service Centre') then raise exception 'RENEWAL_LOCATION_REQUIRED';end if;
  if coalesce(array_length(p_document_ids,1),0) not between 1 and 20 then raise exception 'EVIDENCE_SELECTION_REQUIRED';end if;
  select jsonb_agg(jsonb_build_object('id',v.id,'sha256',v.sha256,'filename',v.original_filename,'mimeType',v.mime_type,'targetSlot','evidence') order by v.id)
    into v_attachments from public.document_versions v join public.documents d on d.id=v.document_id and d.owner_id=v.owner_id where v.owner_id=auth.uid() and v.id=any(p_document_ids) and d.deleted_at is null and v.extraction_state='completed';
  if jsonb_array_length(coalesce(v_attachments,'[]'::jsonb))<>array_length(p_document_ids,1) then raise exception 'EVIDENCE_NOT_READABLE_OR_NOT_OWNED';end if;
  v_payload:=jsonb_build_object('schemaVersion',1,'applicationId',p_application_id,'destination',jsonb_build_object('origin',p_origin,'path','/apply/'||v_kind,'accountLabel','Fictional PaperTrail demonstration portal'),
    'adapter','papertrail-reference-v1','actions',jsonb_build_array(jsonb_build_object('id','reference-demo-submit','kind','submit','fieldValues',p_fields,'attachmentVersions',v_attachments,'declarations',jsonb_build_array(jsonb_build_object('text','I understand this is a fictional reference portal and am using test data only.','userAttestationRequired',true)),'expectedObservation','A persisted receipt observed in the independent fictional portal','reversible',false)));
  insert into public.changesets(owner_id,application_id,payload,payload_sha256,prerequisite_vector,expires_at) values(auth.uid(),p_application_id,v_payload,encode(digest(v_payload::text,'sha256'),'hex'),jsonb_build_object('applicationMaterialVersion',v_version),now()+interval '30 minutes') returning id into v_id;
  return v_id;
end;$$;

create or replace function public.begin_browser_execution(p_changeset_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_change public.changesets%rowtype;v_id uuid;
begin
  select * into v_change from public.changesets where id=p_changeset_id and owner_id=auth.uid() for update;
  if not found or v_change.state<>'approved' or v_change.expires_at<=now() or v_change.payload->>'adapter'<>'papertrail-reference-v1' then raise exception 'BROWSER_APPROVAL_REQUIRED';end if;
  if v_change.prerequisite_vector<>jsonb_build_object('applicationMaterialVersion',(select material_version from public.applications where owner_id=auth.uid() and id=v_change.application_id))then raise exception 'BROWSER_APPROVAL_STALE';end if;
  insert into public.browser_executions(owner_id,application_id,changeset_id)values(auth.uid(),v_change.application_id,v_change.id) on conflict(changeset_id)do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.browser_executions where changeset_id=v_change.id;end if;
  return v_id;
end;$$;

create or replace function public.authorize_browser_dispatch(p_execution_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_execution public.browser_executions%rowtype;v_change public.changesets%rowtype;
begin
  select * into v_execution from public.browser_executions where id=p_execution_id and owner_id=auth.uid() for update;
  if not found or v_execution.state<>'ready' then return false;end if;
  select * into v_change from public.changesets where id=v_execution.changeset_id and owner_id=auth.uid() for update;
  perform 1 from public.applications where id=v_execution.application_id and owner_id=auth.uid() for update;
  if v_change.state<>'approved' or v_change.expires_at<=now() or v_change.prerequisite_vector<>jsonb_build_object('applicationMaterialVersion',(select material_version from public.applications where id=v_execution.application_id)) then return false;end if;
  if exists(select 1 from jsonb_array_elements(v_change.payload#>'{actions,0,attachmentVersions}') a where not exists(select 1 from public.document_versions v join public.documents d on d.id=v.document_id and d.owner_id=v.owner_id where v.id=(a->>'id')::uuid and v.owner_id=auth.uid() and v.sha256=a->>'sha256' and d.deleted_at is null))then return false;end if;
  update public.browser_executions set state='dispatching' where id=p_execution_id;
  return true;
end;$$;

create or replace function public.complete_observed_browser_execution(p_owner_id uuid,p_execution_id uuid,p_reference text,p_observation jsonb)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_execution public.browser_executions%rowtype;v_change public.changesets%rowtype;
begin
  if p_reference!~'^DEMO-[A-Z0-9-]{8,80}$' then raise exception 'OBSERVED_RECEIPT_INVALID';end if;
  select * into v_execution from public.browser_executions where id=p_execution_id and owner_id=p_owner_id and state in('dispatching','outcome_unknown') for update;
  if not found then raise exception 'BROWSER_EXECUTION_NOT_RECONCILABLE';end if;
  select * into v_change from public.changesets where id=v_execution.changeset_id and owner_id=p_owner_id for update;
  insert into public.reference_portal_receipts(owner_id,application_id,changeset_id,reference_code,payload_sha256)values(p_owner_id,v_execution.application_id,v_execution.changeset_id,p_reference,v_change.payload_sha256)on conflict(changeset_id)do nothing;
  update public.browser_executions set state='completed',observation=p_observation,error_code=null where id=p_execution_id;
  update public.changesets set state='executed',row_version=row_version+1 where id=v_change.id;
  return p_reference;
end;$$;

-- The former RPC created a receipt without operating a browser. All new execution
-- now requires the observed adapter flow above.
revoke execute on function public.execute_reference_portal_changeset(uuid) from authenticated;
revoke all on function public.create_reference_browser_review(uuid,text,jsonb,uuid[]),public.begin_browser_execution(uuid),public.authorize_browser_dispatch(uuid) from public,anon;
grant execute on function public.create_reference_browser_review(uuid,text,jsonb,uuid[]),public.begin_browser_execution(uuid),public.authorize_browser_dispatch(uuid) to authenticated;
revoke all on function public.complete_observed_browser_execution(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_observed_browser_execution(uuid,uuid,text,jsonb) to service_role,postgres;

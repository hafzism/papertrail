-- Owners can inspect a private PDF form before proposing any mapping or output.
create table public.document_form_inspections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  document_version_id uuid not null,
  job_id uuid unique references public.jobs(id) on delete set null,
  state text not null default 'queued' check (state in ('queued', 'running', 'completed', 'needs_input', 'failed')),
  form_state text check (form_state in ('fillable', 'assisted')),
  reason_code text,
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  row_version integer not null default 0 check (row_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, document_version_id) references public.document_versions(owner_id, id) on delete cascade
);
create unique index document_form_inspections_one_active_idx
  on public.document_form_inspections (owner_id, document_version_id) where state in ('queued', 'running');
create index document_form_inspections_owner_version_idx on public.document_form_inspections (owner_id, document_version_id, created_at desc);
create trigger document_form_inspections_touch before update on public.document_form_inspections for each row execute procedure public.touch_mutable_row();
alter table public.document_form_inspections enable row level security;
create policy document_form_inspections_owner_read on public.document_form_inspections for select using (owner_id = auth.uid());
revoke all on public.document_form_inspections from public, anon, authenticated;
grant select on public.document_form_inspections to authenticated;

create or replace function public.request_document_form_inspection(p_document_version_id uuid)
returns table (inspection_id uuid, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_deletion_generation integer;
  v_job_id uuid;
begin
  if v_owner_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.document_versions as version
    join public.documents as document on document.id = version.document_id and document.owner_id = version.owner_id
    where version.id = p_document_version_id and version.owner_id = v_owner_id
      and version.mime_type = 'application/pdf' and document.deleted_at is null
    for share;
  if not found then raise exception 'FORM_INSPECTION_DOCUMENT_NOT_AVAILABLE'; end if;
  if exists (select 1 from public.document_form_inspections where owner_id = v_owner_id and document_version_id = p_document_version_id and state in ('queued', 'running')) then
    raise exception 'FORM_INSPECTION_ALREADY_QUEUED';
  end if;
  select deletion_generation into v_deletion_generation from public.profiles where user_id = v_owner_id for share;
  insert into public.document_form_inspections (owner_id, document_version_id) values (v_owner_id, p_document_version_id) returning id into inspection_id;
  insert into public.jobs (kind, owner_id, dedupe_key, payload)
  values ('inspect_acroform', v_owner_id, 'form-inspection:' || inspection_id::text,
    jsonb_build_object('inspectionId', inspection_id, 'documentVersionId', p_document_version_id, 'deletionGeneration', v_deletion_generation))
  returning id into v_job_id;
  update public.document_form_inspections set job_id = v_job_id where id = inspection_id;
  job_id := v_job_id;
  return next;
end;
$$;

create or replace function public.begin_document_form_inspection(p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_inspection_id uuid, p_deletion_generation integer)
returns table (object_path text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.document_form_inspections as inspection set state = 'running', updated_at = now()
  from public.jobs as job, public.document_versions as version, public.documents as document, public.profiles as profile
  where inspection.id = p_inspection_id and inspection.owner_id = p_owner_id and inspection.state in ('queued', 'running')
    and version.id = inspection.document_version_id
    and document.id = version.document_id and document.owner_id = version.owner_id
    and job.id = p_job_id and job.owner_id = p_owner_id and job.kind = 'inspect_acroform' and job.state = 'running'
    and job.fencing_token = p_fencing_token and job.lease_expires_at > now() and profile.user_id = job.owner_id and profile.deletion_generation = p_deletion_generation
    and job.payload->>'inspectionId' = p_inspection_id::text and job.payload->>'documentVersionId' = inspection.document_version_id::text
    and document.deleted_at is null and version.mime_type = 'application/pdf'
  returning version.object_path into object_path;
  if object_path is null then return; end if;
  return next;
end;
$$;

create or replace function public.record_document_form_inspection(p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_inspection_id uuid, p_deletion_generation integer, p_state text, p_form_state text default null, p_reason_code text default null, p_fields jsonb default '[]'::jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_state not in ('completed', 'needs_input', 'failed') or (p_form_state is not null and p_form_state not in ('fillable', 'assisted')) or jsonb_typeof(p_fields) <> 'array' then raise exception 'FORM_INSPECTION_INVALID_RESULT'; end if;
  update public.document_form_inspections as inspection set state = p_state, form_state = p_form_state, reason_code = p_reason_code, fields = p_fields, updated_at = now()
  from public.jobs as job join public.profiles as profile on profile.user_id = job.owner_id
  where inspection.id = p_inspection_id and inspection.owner_id = p_owner_id and inspection.state = 'running'
    and job.id = p_job_id and job.owner_id = p_owner_id and job.kind = 'inspect_acroform' and job.state = 'running'
    and job.fencing_token = p_fencing_token and job.lease_expires_at > now() and profile.deletion_generation = p_deletion_generation
    and job.payload->>'inspectionId' = p_inspection_id::text;
  return found;
end;
$$;
revoke all on function public.request_document_form_inspection(uuid) from public, anon;
grant execute on function public.request_document_form_inspection(uuid) to authenticated;
revoke all on function public.begin_document_form_inspection(uuid, bigint, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.record_document_form_inspection(uuid, bigint, uuid, uuid, integer, text, text, text, jsonb) from public, anon, authenticated;

-- W3 foundation: an owner can request a private, deterministic packet manifest.
-- A manifest is evidence/provenance only. It never asserts that a packet is complete,
-- approved, or ready for external submission.

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  kind text not null check (kind in ('packet_manifest')),
  object_path text not null unique check (char_length(object_path) between 1 and 500 and object_path ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'),
  sha256 text not null check (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  input_version_vector jsonb not null,
  status text not null default 'needs_review' check (status in ('valid', 'stale', 'needs_review')),
  render_check_status text not null default 'not_applicable' check (render_check_status in ('not_applicable', 'pending', 'passed', 'failed')),
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);

create index artifacts_owner_application_created_idx on public.artifacts (owner_id, application_id, created_at desc);

create table public.artifact_generation_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  kind text not null check (kind = 'packet_manifest'),
  input_version_vector jsonb not null,
  job_id uuid unique references public.jobs(id) on delete set null,
  generated_artifact_id uuid unique references public.artifacts(id) on delete restrict,
  state text not null default 'queued' check (state in ('queued', 'running', 'completed', 'failed')),
  error_code text check (char_length(error_code) between 1 and 160),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);

create unique index artifact_generation_runs_one_active_packet_idx
  on public.artifact_generation_runs (owner_id, application_id, kind)
  where state in ('queued', 'running');
create index artifact_generation_runs_owner_application_idx
  on public.artifact_generation_runs (owner_id, application_id, created_at desc);

alter table public.artifacts enable row level security;
alter table public.artifact_generation_runs enable row level security;
create policy artifacts_owner_read on public.artifacts for select using (owner_id = auth.uid());
create policy artifact_generation_runs_owner_read on public.artifact_generation_runs for select using (owner_id = auth.uid());
revoke all on public.artifacts, public.artifact_generation_runs from public, anon, authenticated;
grant select on public.artifacts, public.artifact_generation_runs to authenticated;

-- This vector has immutable IDs and hashes/statuses only. It is recomputed before
-- generation and recording, so a worker cannot publish a manifest for changed inputs.
create or replace function public.private_packet_manifest_input_vector(
  p_owner_id uuid,
  p_application_id uuid
)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'application', coalesce((
      select jsonb_build_object('id', application.id, 'title', application.title, 'materialVersion', application.material_version)
      from public.applications as application
      where application.id = p_application_id and application.owner_id = p_owner_id
    ), 'null'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id, 'documentId', item.document_id, 'sha256', item.sha256,
        'mimeType', item.mime_type, 'byteSize', item.byte_size, 'pageCount', item.page_count
      ) order by item.id)
      from (
        select distinct version.id, version.document_id, version.sha256, version.mime_type, version.byte_size, version.page_count
        from public.evidence_bindings as binding
        join public.document_versions as version on version.id = binding.document_version_id and version.owner_id = binding.owner_id
        join public.documents as document on document.id = version.document_id and document.owner_id = version.owner_id
        where binding.owner_id = p_owner_id and binding.application_id = p_application_id
          and binding.binding_state = 'confirmed' and document.deleted_at is null
      ) as item
    ), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', requirement.id, 'logicalKey', requirement.logical_key, 'kind', requirement.kind,
        'citationSourceHash', requirement.citation_source_hash, 'reviewState', requirement.review_state
      ) order by requirement.id)
      from public.private_requirement_versions as requirement
      where requirement.owner_id = p_owner_id and requirement.application_id = p_application_id
    ), '[]'::jsonb),
    'bindings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', binding.id, 'requirementId', binding.private_requirement_id,
        'documentVersionId', binding.document_version_id, 'state', binding.binding_state
      ) order by binding.id)
      from public.evidence_bindings as binding
      where binding.owner_id = p_owner_id and binding.application_id = p_application_id
        and binding.binding_state = 'confirmed'
    ), '[]'::jsonb)
  );
$$;

-- This is the complete, owner-scoped source the trusted worker may serialize. It
-- deliberately excludes chat transcripts and storage object paths.
create or replace function public.private_packet_manifest_input(
  p_owner_id uuid,
  p_application_id uuid
)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'manifestVersion', 'packet-manifest-v1',
    'submissionReady', false,
    'application', (
      select jsonb_build_object('id', application.id, 'title', application.title, 'materialVersion', application.material_version)
      from public.applications as application
      where application.id = p_application_id and application.owner_id = p_owner_id
    ),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id, 'documentId', item.document_id, 'filename', item.original_filename,
        'mimeType', item.mime_type, 'sha256', item.sha256, 'byteSize', item.byte_size, 'pageCount', item.page_count
      ) order by item.id)
      from (
        select distinct version.id, version.document_id, version.original_filename, version.mime_type, version.sha256, version.byte_size, version.page_count
        from public.evidence_bindings as binding
        join public.document_versions as version on version.id = binding.document_version_id and version.owner_id = binding.owner_id
        join public.documents as document on document.id = version.document_id and document.owner_id = version.owner_id
        where binding.owner_id = p_owner_id and binding.application_id = p_application_id
          and binding.binding_state = 'confirmed' and document.deleted_at is null
      ) as item
    ), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', requirement.id, 'logicalKey', requirement.logical_key, 'kind', requirement.kind,
        'label', requirement.label, 'citationExcerpt', requirement.citation_excerpt,
        'citationSourceHash', requirement.citation_source_hash, 'reviewState', requirement.review_state
      ) order by requirement.id)
      from public.private_requirement_versions as requirement
      where requirement.owner_id = p_owner_id and requirement.application_id = p_application_id
    ), '[]'::jsonb),
    'bindings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', binding.id, 'requirementId', binding.private_requirement_id,
        'documentVersionId', binding.document_version_id, 'state', binding.binding_state
      ) order by binding.id)
      from public.evidence_bindings as binding
      where binding.owner_id = p_owner_id and binding.application_id = p_application_id
        and binding.binding_state = 'confirmed'
    ), '[]'::jsonb)
  );
$$;

create or replace function public.request_private_packet_manifest(p_application_id uuid)
returns table (artifact_run_id uuid, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_deletion_generation integer;
  v_input_vector jsonb;
  v_run_id uuid;
  v_job_id uuid;
  v_sequence bigint;
begin
  if v_owner_id is null then raise exception 'PACKET_MANIFEST_UNAUTHENTICATED'; end if;
  perform 1 from public.applications
    where id = p_application_id and owner_id = v_owner_id and lifecycle_state in ('draft', 'prepared')
    for update;
  if not found then raise exception 'PACKET_MANIFEST_APPLICATION_NOT_PREPARABLE_OR_NOT_FOUND'; end if;
  if exists (
    select 1 from public.artifact_generation_runs
    where owner_id = v_owner_id and application_id = p_application_id and kind = 'packet_manifest'
      and state in ('queued', 'running')
  ) then raise exception 'PACKET_MANIFEST_ALREADY_QUEUED'; end if;
  select deletion_generation into v_deletion_generation
  from public.profiles where user_id = v_owner_id for share;
  if v_deletion_generation is null then raise exception 'PACKET_MANIFEST_PROFILE_MISSING'; end if;
  v_input_vector := public.private_packet_manifest_input_vector(v_owner_id, p_application_id);
  if v_input_vector->'application' = 'null'::jsonb then raise exception 'PACKET_MANIFEST_APPLICATION_NOT_PREPARABLE_OR_NOT_FOUND'; end if;

  insert into public.artifact_generation_runs (owner_id, application_id, kind, input_version_vector)
  values (v_owner_id, p_application_id, 'packet_manifest', v_input_vector)
  returning id into v_run_id;
  insert into public.jobs (kind, owner_id, dedupe_key, payload)
  values (
    'prepare_packet_manifest', v_owner_id, 'packet-manifest:' || v_run_id::text,
    jsonb_build_object('artifactRunId', v_run_id, 'applicationId', p_application_id, 'deletionGeneration', v_deletion_generation)
  ) returning id into v_job_id;
  update public.artifact_generation_runs set job_id = v_job_id where id = v_run_id;
  insert into public.outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
  values (
    'private_packet_manifest_queued', 'artifact_generation_run', v_run_id,
    jsonb_build_object('ownerId', v_owner_id, 'applicationId', p_application_id, 'artifactRunId', v_run_id, 'jobId', v_job_id),
    'private-packet-manifest:' || v_run_id::text
  );
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (
    v_owner_id, p_application_id, v_sequence, 'owner', 'private_packet_manifest_requested',
    'Private packet manifest queued for review', jsonb_build_object('artifactRunId', v_run_id, 'jobId', v_job_id)
  );
  artifact_run_id := v_run_id;
  job_id := v_job_id;
  return next;
end;
$$;

create or replace function public.begin_private_packet_manifest(
  p_job_id uuid,
  p_fencing_token bigint,
  p_owner_id uuid,
  p_artifact_run_id uuid,
  p_deletion_generation integer
)
returns table (state text, input_version_vector jsonb, manifest_input jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_application_id uuid;
  v_expected_vector jsonb;
  v_current_vector jsonb;
begin
  select run.application_id, run.input_version_vector
  into v_application_id, v_expected_vector
  from public.artifact_generation_runs as run
  join public.jobs as job on job.id = p_job_id
  join public.profiles as profile on profile.user_id = job.owner_id
  where run.id = p_artifact_run_id and run.owner_id = p_owner_id and run.state in ('queued', 'running')
    and job.owner_id = p_owner_id and job.kind = 'prepare_packet_manifest'
    and job.state = 'running' and job.fencing_token = p_fencing_token and job.lease_expires_at > now()
    and job.payload->>'artifactRunId' = p_artifact_run_id::text
    and job.payload->>'applicationId' = run.application_id::text
    and (job.payload->>'deletionGeneration')::integer = p_deletion_generation
    and profile.deletion_generation = p_deletion_generation
  for update of run;
  if v_application_id is null then return; end if;
  v_current_vector := public.private_packet_manifest_input_vector(p_owner_id, v_application_id);
  if v_current_vector <> v_expected_vector then
    update public.artifact_generation_runs as run
    set state = 'failed', error_code = 'PACKET_MANIFEST_INPUT_CHANGED', completed_at = now(), updated_at = now()
    where run.id = p_artifact_run_id and run.state in ('queued', 'running');
    return query select 'input_changed'::text, null::jsonb, null::jsonb;
    return;
  end if;
  update public.artifact_generation_runs as run
  set state = 'running', started_at = coalesce(started_at, now()), updated_at = now()
  where run.id = p_artifact_run_id and run.state in ('queued', 'running');
  return query select 'ready'::text, v_current_vector, public.private_packet_manifest_input(p_owner_id, v_application_id);
end;
$$;

create or replace function public.record_private_packet_manifest(
  p_job_id uuid,
  p_fencing_token bigint,
  p_owner_id uuid,
  p_artifact_run_id uuid,
  p_deletion_generation integer,
  p_object_path text,
  p_sha256 text,
  p_input_version_vector jsonb
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_application_id uuid;
  v_artifact_id uuid;
  v_sequence bigint;
begin
  if char_length(p_object_path) not between 1 and 500 or p_object_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then
    raise exception 'PACKET_MANIFEST_INVALID_OBJECT_PATH';
  end if;
  if p_sha256 !~ '^[A-Fa-f0-9]{64}$' or jsonb_typeof(p_input_version_vector) <> 'object' then
    raise exception 'PACKET_MANIFEST_INVALID_RESULT';
  end if;
  select run.application_id into v_application_id
  from public.artifact_generation_runs as run
  join public.jobs as job on job.id = p_job_id
  join public.profiles as profile on profile.user_id = job.owner_id
  where run.id = p_artifact_run_id and run.owner_id = p_owner_id and run.state = 'running'
    and run.input_version_vector = p_input_version_vector
    and job.owner_id = p_owner_id and job.kind = 'prepare_packet_manifest'
    and job.state = 'running' and job.fencing_token = p_fencing_token and job.lease_expires_at > now()
    and job.payload->>'artifactRunId' = p_artifact_run_id::text
    and (job.payload->>'deletionGeneration')::integer = p_deletion_generation
    and profile.deletion_generation = p_deletion_generation
  for update of run;
  if v_application_id is null or public.private_packet_manifest_input_vector(p_owner_id, v_application_id) <> p_input_version_vector then
    return false;
  end if;
  insert into public.artifacts (owner_id, application_id, kind, object_path, sha256, input_version_vector, status, render_check_status)
  values (p_owner_id, v_application_id, 'packet_manifest', p_object_path, lower(p_sha256), p_input_version_vector, 'needs_review', 'not_applicable')
  returning id into v_artifact_id;
  update public.artifact_generation_runs
  set state = 'completed', generated_artifact_id = v_artifact_id, completed_at = now(), updated_at = now()
  where id = p_artifact_run_id and state = 'running';
  if not found then return false; end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (
    p_owner_id, v_application_id, v_sequence, 'worker', 'private_packet_manifest_completed',
    'Private packet manifest is ready for review', jsonb_build_object('artifactRunId', p_artifact_run_id, 'artifactId', v_artifact_id)
  );
  return true;
end;
$$;

create or replace function public.fail_private_packet_manifest(
  p_job_id uuid,
  p_fencing_token bigint,
  p_owner_id uuid,
  p_artifact_run_id uuid,
  p_deletion_generation integer,
  p_error_code text
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_application_id uuid;
  v_sequence bigint;
begin
  if char_length(coalesce(p_error_code, '')) not between 1 and 160 then
    raise exception 'PACKET_MANIFEST_INVALID_ERROR_CODE';
  end if;
  update public.artifact_generation_runs as run
  set state = 'failed', error_code = p_error_code, completed_at = now(), updated_at = now()
  from public.jobs as job
  join public.profiles as profile on profile.user_id = job.owner_id
  where run.id = p_artifact_run_id and run.owner_id = p_owner_id and run.state in ('queued', 'running')
    and job.id = p_job_id and job.owner_id = p_owner_id and job.kind = 'prepare_packet_manifest'
    and job.state = 'running' and job.fencing_token = p_fencing_token and job.lease_expires_at > now()
    and job.payload->>'artifactRunId' = p_artifact_run_id::text
    and (job.payload->>'deletionGeneration')::integer = p_deletion_generation
    and profile.deletion_generation = p_deletion_generation
  returning run.application_id into v_application_id;
  if v_application_id is null then return false; end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (
    p_owner_id, v_application_id, v_sequence, 'worker', 'private_packet_manifest_failed',
    'Private packet manifest needs attention', jsonb_build_object('artifactRunId', p_artifact_run_id, 'errorCode', p_error_code)
  );
  return true;
end;
$$;

-- Deleting a source document marks dependent packet manifests stale and returns their
-- private storage paths alongside extraction paths, so callers remove derivatives too.
create or replace function public.remove_private_document(p_document_id uuid)
returns table (document_object_paths text[], artifact_object_paths text[])
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then raise exception 'DOCUMENT_REMOVE_UNAUTHENTICATED'; end if;
  update public.documents
  set deleted_at = now(), updated_at = now()
  where id = p_document_id and owner_id = v_owner_id and deleted_at is null;
  if not found then raise exception 'DOCUMENT_REMOVE_NOT_AVAILABLE'; end if;
  update public.evidence_bindings as binding
  set binding_state = 'needs_review', confirmed_by = null, confirmed_at = null
  from public.document_versions as version
  where version.document_id = p_document_id and binding.document_version_id = version.id
    and binding.owner_id = v_owner_id and binding.binding_state <> 'needs_review';
  update public.artifacts as artifact
  set status = 'stale'
  where artifact.owner_id = v_owner_id and artifact.status <> 'stale'
    and exists (
      select 1 from public.document_versions as version,
        jsonb_array_elements(coalesce(artifact.input_version_vector->'documents', '[]'::jsonb)) as document_vector
      where version.document_id = p_document_id and version.owner_id = v_owner_id
        and document_vector->>'id' = version.id::text
    );
  return query
  select
    coalesce((
      select array_agg(distinct version.object_path order by version.object_path)
      from public.document_versions as version
      where version.document_id = p_document_id and version.owner_id = v_owner_id
    ), '{}'::text[]),
    coalesce((
      select array_agg(distinct path order by path)
      from (
        select extraction.text_object_path as path
        from public.document_versions as version
        join public.document_extractions as extraction on extraction.document_version_id = version.id and extraction.owner_id = v_owner_id
        where version.document_id = p_document_id and version.owner_id = v_owner_id and extraction.text_object_path is not null
        union
        select artifact.object_path as path
        from public.artifacts as artifact
        where artifact.owner_id = v_owner_id
          and exists (
            select 1 from public.document_versions as version,
              jsonb_array_elements(coalesce(artifact.input_version_vector->'documents', '[]'::jsonb)) as document_vector
            where version.document_id = p_document_id and version.owner_id = v_owner_id
              and document_vector->>'id' = version.id::text
          )
      ) as derived
    ), '{}'::text[]);
end;
$$;

revoke all on function public.private_packet_manifest_input_vector(uuid, uuid) from public, anon, authenticated;
revoke all on function public.private_packet_manifest_input(uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_private_packet_manifest(uuid) from public, anon;
grant execute on function public.request_private_packet_manifest(uuid) to authenticated;
revoke all on function public.begin_private_packet_manifest(uuid, bigint, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.record_private_packet_manifest(uuid, bigint, uuid, uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_private_packet_manifest(uuid, bigint, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.remove_private_document(uuid) from public, anon;
grant execute on function public.remove_private_document(uuid) to authenticated;

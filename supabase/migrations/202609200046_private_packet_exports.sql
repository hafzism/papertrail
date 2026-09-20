-- A packet export is an owner-readable review bundle. It intentionally carries
-- submission_ready=false in its manifest and is never an execution authority.
create table public.packet_exports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  manifest_artifact_id uuid not null unique references public.artifacts(id) on delete cascade,
  object_path text not null unique check (object_path ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'),
  sha256 text not null check (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  input_version_vector jsonb not null check (jsonb_typeof(input_version_vector) = 'object'),
  status text not null default 'needs_review' check (status in ('needs_review', 'stale')),
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);
create index packet_exports_owner_application_created_idx on public.packet_exports (owner_id, application_id, created_at desc);
alter table public.packet_exports enable row level security;
create policy packet_exports_owner_read on public.packet_exports for select using (owner_id = auth.uid());
revoke all on public.packet_exports from public, anon, authenticated;
grant select on public.packet_exports to authenticated;

create or replace function public.private_packet_export_files(p_owner_id uuid, p_application_id uuid)
returns table (object_path text, archive_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select version.object_path,
    'evidence/' || version.id::text || '-' || regexp_replace(version.original_filename, '[^A-Za-z0-9._-]+', '_', 'g')
  from public.evidence_bindings as binding
  join public.document_versions as version on version.id = binding.document_version_id and version.owner_id = binding.owner_id
  join public.documents as document on document.id = version.document_id and document.owner_id = version.owner_id
  where binding.owner_id = p_owner_id and binding.application_id = p_application_id
    and binding.binding_state = 'confirmed' and document.deleted_at is null
  order by version.id;
$$;

create or replace function public.record_private_packet_bundle(
  p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_artifact_run_id uuid, p_deletion_generation integer,
  p_manifest_object_path text, p_manifest_sha256 text, p_packet_object_path text, p_packet_sha256 text, p_input_version_vector jsonb
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_application_id uuid; v_artifact_id uuid; v_sequence bigint;
begin
  if p_manifest_object_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' or p_packet_object_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    or p_manifest_sha256 !~ '^[A-Fa-f0-9]{64}$' or p_packet_sha256 !~ '^[A-Fa-f0-9]{64}$' then raise exception 'PACKET_BUNDLE_RESULT_INVALID'; end if;
  select run.application_id into v_application_id
  from public.artifact_generation_runs as run join public.jobs as job on job.id = p_job_id join public.profiles as profile on profile.user_id = job.owner_id
  where run.id = p_artifact_run_id and run.owner_id = p_owner_id and run.state = 'running' and run.input_version_vector = p_input_version_vector
    and job.owner_id = p_owner_id and job.kind = 'prepare_packet_manifest' and job.state = 'running' and job.fencing_token = p_fencing_token and job.lease_expires_at > now()
    and job.payload->>'artifactRunId' = p_artifact_run_id::text and (job.payload->>'deletionGeneration')::integer = p_deletion_generation and profile.deletion_generation = p_deletion_generation
  for update of run;
  if v_application_id is null or public.private_packet_manifest_input_vector(p_owner_id, v_application_id) <> p_input_version_vector then return false; end if;
  insert into public.artifacts (owner_id, application_id, kind, object_path, sha256, input_version_vector, status, render_check_status)
    values (p_owner_id, v_application_id, 'packet_manifest', p_manifest_object_path, lower(p_manifest_sha256), p_input_version_vector, 'needs_review', 'not_applicable') returning id into v_artifact_id;
  insert into public.packet_exports (owner_id, application_id, manifest_artifact_id, object_path, sha256, input_version_vector)
    values (p_owner_id, v_application_id, v_artifact_id, p_packet_object_path, lower(p_packet_sha256), p_input_version_vector);
  update public.artifact_generation_runs set state = 'completed', generated_artifact_id = v_artifact_id, completed_at = now(), updated_at = now() where id = p_artifact_run_id and state = 'running';
  if not found then return false; end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
    values (p_owner_id, v_application_id, v_sequence, 'worker', 'private_packet_bundle_completed', 'Private review packet bundle is ready', jsonb_build_object('artifactRunId', p_artifact_run_id, 'artifactId', v_artifact_id));
  return true;
end;
$$;
revoke all on function public.private_packet_export_files(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_private_packet_bundle(uuid, bigint, uuid, uuid, integer, text, text, text, text, jsonb) from public, anon, authenticated;

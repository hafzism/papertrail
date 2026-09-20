-- W3: an owner may prepare a separate, review-only ordinary AcroForm derivative.
-- The original private document is never modified. Signed, XFA, unsupported, and
-- non-Latin inputs remain on the assisted route enforced by the worker/domain layer.

alter table public.artifacts drop constraint artifacts_kind_check;
alter table public.artifacts add constraint artifacts_kind_check
  check (kind in ('packet_manifest', 'filled_acroform'));
alter table public.artifact_generation_runs drop constraint artifact_generation_runs_kind_check;
alter table public.artifact_generation_runs add constraint artifact_generation_runs_kind_check
  check (kind in ('packet_manifest', 'filled_acroform'));

create or replace function public.private_acroform_derivative_input_vector(
  p_owner_id uuid,
  p_application_id uuid,
  p_inspection_id uuid
)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'application', coalesce((
      select jsonb_build_object('id', application.id, 'materialVersion', application.material_version)
      from public.applications as application
      where application.id = p_application_id and application.owner_id = p_owner_id
    ), 'null'::jsonb),
    'inspection', coalesce((
      select jsonb_build_object(
        'id', inspection.id, 'documentVersionId', version.id, 'sha256', version.sha256,
        'mimeType', version.mime_type, 'formState', inspection.form_state, 'fields', inspection.fields
      )
      from public.document_form_inspections as inspection
      join public.document_versions as version on version.id = inspection.document_version_id and version.owner_id = inspection.owner_id
      join public.documents as document on document.id = version.document_id and document.owner_id = version.owner_id
      where inspection.id = p_inspection_id and inspection.owner_id = p_owner_id
        and inspection.state = 'completed' and inspection.form_state = 'fillable'
        and document.deleted_at is null
    ), 'null'::jsonb),
    'mappings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id, 'fieldName', item.field_name, 'profileFactVersionId', item.profile_fact_version_id,
        'factKey', item.fact_key, 'value', item.value_json
      ) order by item.field_name, item.id)
      from (
        select distinct on (mapping.field_name)
          mapping.id, mapping.field_name, mapping.profile_fact_version_id, mapping.fact_key, mapping.value_json
        from public.document_form_field_mappings as mapping
        where mapping.owner_id = p_owner_id and mapping.inspection_id = p_inspection_id
          and mapping.review_state = 'owner_confirmed'
        order by mapping.field_name, mapping.created_at desc, mapping.id desc
      ) as item
    ), '[]'::jsonb)
  );
$$;

create or replace function public.request_private_acroform_derivative(
  p_application_id uuid,
  p_inspection_id uuid
)
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
  if v_owner_id is null then raise exception 'ACROFORM_DERIVATIVE_AUTH_REQUIRED'; end if;
  perform 1 from public.applications
  where id = p_application_id and owner_id = v_owner_id and lifecycle_state in ('draft', 'prepared')
  for share;
  if not found then raise exception 'ACROFORM_DERIVATIVE_APPLICATION_NOT_PREPARABLE_OR_NOT_FOUND'; end if;
  v_input_vector := public.private_acroform_derivative_input_vector(v_owner_id, p_application_id, p_inspection_id);
  if v_input_vector->'application' = 'null'::jsonb then raise exception 'ACROFORM_DERIVATIVE_APPLICATION_NOT_PREPARABLE_OR_NOT_FOUND'; end if;
  if v_input_vector->'inspection' = 'null'::jsonb then raise exception 'ACROFORM_DERIVATIVE_INSPECTION_NOT_AVAILABLE'; end if;
  if jsonb_array_length(v_input_vector->'mappings') = 0 then raise exception 'ACROFORM_DERIVATIVE_MAPPING_REQUIRED'; end if;
  if exists (
    select 1 from public.artifact_generation_runs
    where owner_id = v_owner_id and application_id = p_application_id and kind = 'filled_acroform'
      and state in ('queued', 'running')
  ) then raise exception 'ACROFORM_DERIVATIVE_ALREADY_QUEUED'; end if;
  select deletion_generation into v_deletion_generation from public.profiles where user_id = v_owner_id for share;
  insert into public.artifact_generation_runs (owner_id, application_id, kind, input_version_vector)
  values (v_owner_id, p_application_id, 'filled_acroform', v_input_vector)
  returning id into v_run_id;
  insert into public.jobs (kind, owner_id, dedupe_key, payload)
  values (
    'prepare_filled_acroform', v_owner_id, 'filled-acroform:' || v_run_id::text,
    jsonb_build_object('artifactRunId', v_run_id, 'applicationId', p_application_id, 'inspectionId', p_inspection_id, 'deletionGeneration', v_deletion_generation)
  ) returning id into v_job_id;
  update public.artifact_generation_runs set job_id = v_job_id where id = v_run_id;
  insert into public.outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
  values (
    'private_acroform_derivative_queued', 'artifact_generation_run', v_run_id,
    jsonb_build_object('ownerId', v_owner_id, 'applicationId', p_application_id, 'inspectionId', p_inspection_id, 'artifactRunId', v_run_id, 'jobId', v_job_id),
    'private-acroform-derivative:' || v_run_id::text
  );
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (
    v_owner_id, p_application_id, v_sequence, 'owner', 'private_acroform_derivative_requested',
    'Private filled PDF derivative queued for review', jsonb_build_object('artifactRunId', v_run_id, 'inspectionId', p_inspection_id, 'jobId', v_job_id)
  );
  artifact_run_id := v_run_id;
  job_id := v_job_id;
  return next;
end;
$$;

create or replace function public.begin_private_acroform_derivative(
  p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_artifact_run_id uuid, p_deletion_generation integer
)
returns table (state text, input_version_vector jsonb, object_path text, field_values jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_application_id uuid;
  v_expected_vector jsonb;
  v_inspection_id uuid;
  v_current_vector jsonb;
begin
  select run.application_id, run.input_version_vector, (job.payload->>'inspectionId')::uuid
  into v_application_id, v_expected_vector, v_inspection_id
  from public.artifact_generation_runs as run
  join public.jobs as job on job.id = p_job_id
  join public.profiles as profile on profile.user_id = job.owner_id
  where run.id = p_artifact_run_id and run.owner_id = p_owner_id and run.kind = 'filled_acroform' and run.state in ('queued', 'running')
    and job.owner_id = p_owner_id and job.kind = 'prepare_filled_acroform' and job.state = 'running'
    and job.fencing_token = p_fencing_token and job.lease_expires_at > now()
    and job.payload->>'artifactRunId' = p_artifact_run_id::text and job.payload->>'applicationId' = run.application_id::text
    and (job.payload->>'deletionGeneration')::integer = p_deletion_generation and profile.deletion_generation = p_deletion_generation
  for update of run;
  if v_application_id is null then return; end if;
  v_current_vector := public.private_acroform_derivative_input_vector(p_owner_id, v_application_id, v_inspection_id);
  if v_current_vector <> v_expected_vector then
    update public.artifact_generation_runs set state = 'failed', error_code = 'ACROFORM_DERIVATIVE_INPUT_CHANGED', completed_at = now(), updated_at = now()
    where id = p_artifact_run_id and state in ('queued', 'running');
    return query select 'input_changed'::text, null::jsonb, null::text, null::jsonb;
    return;
  end if;
  update public.artifact_generation_runs as run set state = 'running', started_at = coalesce(started_at, now()), updated_at = now()
  where run.id = p_artifact_run_id and run.state in ('queued', 'running');
  return query
  select 'ready'::text, v_current_vector,
    version.object_path,
    coalesce((select jsonb_object_agg(item->>'fieldName', item->'value') from jsonb_array_elements(v_current_vector->'mappings') as item), '{}'::jsonb)
  from public.document_form_inspections as inspection
  join public.document_versions as version on version.id = inspection.document_version_id and version.owner_id = inspection.owner_id
  where inspection.id = v_inspection_id and inspection.owner_id = p_owner_id;
end;
$$;

create or replace function public.record_private_acroform_derivative(
  p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_artifact_run_id uuid, p_deletion_generation integer,
  p_object_path text, p_sha256 text, p_input_version_vector jsonb, p_render_check_status text
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_application_id uuid;
  v_inspection_id uuid;
  v_artifact_id uuid;
  v_sequence bigint;
begin
  if char_length(p_object_path) not between 1 and 500 or p_object_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then raise exception 'ACROFORM_DERIVATIVE_INVALID_OBJECT_PATH'; end if;
  if p_sha256 !~ '^[A-Fa-f0-9]{64}$' or jsonb_typeof(p_input_version_vector) <> 'object' or p_render_check_status not in ('passed', 'failed') then
    raise exception 'ACROFORM_DERIVATIVE_INVALID_RESULT';
  end if;
  select run.application_id, (job.payload->>'inspectionId')::uuid into v_application_id, v_inspection_id
  from public.artifact_generation_runs as run
  join public.jobs as job on job.id = p_job_id
  join public.profiles as profile on profile.user_id = job.owner_id
  where run.id = p_artifact_run_id and run.owner_id = p_owner_id and run.kind = 'filled_acroform' and run.state = 'running'
    and run.input_version_vector = p_input_version_vector
    and job.owner_id = p_owner_id and job.kind = 'prepare_filled_acroform' and job.state = 'running'
    and job.fencing_token = p_fencing_token and job.lease_expires_at > now()
    and job.payload->>'artifactRunId' = p_artifact_run_id::text
    and (job.payload->>'deletionGeneration')::integer = p_deletion_generation and profile.deletion_generation = p_deletion_generation
  for update of run;
  if v_application_id is null or public.private_acroform_derivative_input_vector(p_owner_id, v_application_id, v_inspection_id) <> p_input_version_vector then return false; end if;
  insert into public.artifacts (owner_id, application_id, kind, object_path, sha256, input_version_vector, status, render_check_status)
  values (p_owner_id, v_application_id, 'filled_acroform', p_object_path, lower(p_sha256), p_input_version_vector, 'needs_review', p_render_check_status)
  returning id into v_artifact_id;
  update public.artifact_generation_runs set state = 'completed', generated_artifact_id = v_artifact_id, completed_at = now(), updated_at = now()
  where id = p_artifact_run_id and state = 'running';
  if not found then return false; end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (p_owner_id, v_application_id, v_sequence, 'worker', 'private_acroform_derivative_completed',
    'Private filled PDF derivative is ready for review', jsonb_build_object('artifactRunId', p_artifact_run_id, 'artifactId', v_artifact_id, 'renderCheckStatus', p_render_check_status));
  return true;
end;
$$;

create or replace function public.fail_private_acroform_derivative(
  p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_artifact_run_id uuid, p_deletion_generation integer, p_error_code text
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_application_id uuid; v_sequence bigint;
begin
  if char_length(coalesce(p_error_code, '')) not between 1 and 160 then raise exception 'ACROFORM_DERIVATIVE_INVALID_ERROR_CODE'; end if;
  update public.artifact_generation_runs as run set state = 'failed', error_code = p_error_code, completed_at = now(), updated_at = now()
  from public.jobs as job join public.profiles as profile on profile.user_id = job.owner_id
  where run.id = p_artifact_run_id and run.owner_id = p_owner_id and run.kind = 'filled_acroform' and run.state in ('queued', 'running')
    and job.id = p_job_id and job.owner_id = p_owner_id and job.kind = 'prepare_filled_acroform' and job.state = 'running'
    and job.fencing_token = p_fencing_token and job.lease_expires_at > now()
    and job.payload->>'artifactRunId' = p_artifact_run_id::text
    and (job.payload->>'deletionGeneration')::integer = p_deletion_generation and profile.deletion_generation = p_deletion_generation
  returning run.application_id into v_application_id;
  if v_application_id is null then return false; end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (p_owner_id, v_application_id, v_sequence, 'worker', 'private_acroform_derivative_failed',
    'Private filled PDF derivative needs attention', jsonb_build_object('artifactRunId', p_artifact_run_id, 'errorCode', p_error_code));
  return true;
end;
$$;

revoke all on function public.private_acroform_derivative_input_vector(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_private_acroform_derivative(uuid, uuid) from public, anon;
grant execute on function public.request_private_acroform_derivative(uuid, uuid) to authenticated;
revoke all on function public.begin_private_acroform_derivative(uuid, bigint, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.record_private_acroform_derivative(uuid, bigint, uuid, uuid, integer, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.fail_private_acroform_derivative(uuid, bigint, uuid, uuid, integer, text) from public, anon, authenticated;

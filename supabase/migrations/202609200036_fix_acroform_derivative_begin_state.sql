-- Correct an output-column/table-column name collision in the first derivative
-- fence function. Keep the base migration corrected for fresh projects as well.
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
    update public.artifact_generation_runs as run set state = 'failed', error_code = 'ACROFORM_DERIVATIVE_INPUT_CHANGED', completed_at = now(), updated_at = now()
    where run.id = p_artifact_run_id and run.state in ('queued', 'running');
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

revoke all on function public.begin_private_acroform_derivative(uuid, bigint, uuid, uuid, integer) from public, anon, authenticated;

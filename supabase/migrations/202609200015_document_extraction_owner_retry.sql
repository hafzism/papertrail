-- A retry after installing OCR is an explicit owner action. It never resurrects a failed job
-- automatically and gets a fresh durable job/outbox record.

create or replace function public.retry_document_extraction(p_document_version_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_deletion_generation integer;
  v_job_id uuid;
begin
  if v_owner_id is null then raise exception 'DOCUMENT_RETRY_UNAUTHENTICATED'; end if;
  select deletion_generation into v_deletion_generation from public.profiles where user_id = v_owner_id for share;
  if v_deletion_generation is null then raise exception 'DOCUMENT_RETRY_PROFILE_MISSING'; end if;
  perform 1 from public.document_versions
    where id = p_document_version_id and owner_id = v_owner_id and extraction_state = 'needs_input'
    for update;
  if not found then raise exception 'DOCUMENT_RETRY_NOT_AVAILABLE'; end if;

  update public.document_versions set extraction_state = 'pending'
    where id = p_document_version_id and owner_id = v_owner_id and extraction_state = 'needs_input';
  insert into public.jobs (kind, owner_id, dedupe_key, payload)
  values (
    'extract_document', v_owner_id,
    'extract-document-retry:' || p_document_version_id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('documentVersionId', p_document_version_id, 'deletionGeneration', v_deletion_generation, 'reason', 'owner_requested_retry')
  ) returning id into v_job_id;
  insert into public.outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
  values (
    'document_extraction_retry_requested', 'document_version', p_document_version_id,
    jsonb_build_object('ownerId', v_owner_id, 'documentVersionId', p_document_version_id, 'jobId', v_job_id),
    'document-extraction-retry:' || v_job_id::text
  );
  return v_job_id;
end;
$$;

revoke all on function public.retry_document_extraction(uuid) from public, anon;
grant execute on function public.retry_document_extraction(uuid) to authenticated;

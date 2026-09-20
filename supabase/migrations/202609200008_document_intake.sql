-- Document bytes arrive in owner-scoped Storage first. This transaction creates the authoritative
-- metadata/version, queues extraction, and writes its outbox event together.

drop policy if exists documents_owner on public.documents;
drop policy if exists document_versions_owner on public.document_versions;

create policy documents_owner_read on public.documents for select using (owner_id = auth.uid());
create policy document_versions_owner_read on public.document_versions for select using (owner_id = auth.uid());

revoke insert, update, delete on public.documents from authenticated;
revoke insert, update, delete on public.document_versions from authenticated;
grant select on public.documents, public.document_versions to authenticated;

create or replace function public.create_document_intake(
  p_label text,
  p_document_type text,
  p_object_path text,
  p_sha256 text,
  p_original_filename text,
  p_mime_type text,
  p_byte_size bigint
)
returns table (document_id uuid, document_version_id uuid, job_id uuid)
language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_document_id uuid;
  v_document_version_id uuid;
  v_job_id uuid;
  v_deletion_generation integer;
begin
  if v_owner_id is null then raise exception 'DOCUMENT_INTAKE_UNAUTHENTICATED'; end if;
  if char_length(trim(p_label)) < 1 or char_length(trim(p_label)) > 200 then raise exception 'DOCUMENT_INTAKE_INVALID_LABEL'; end if;
  if p_document_type is not null and char_length(trim(p_document_type)) > 120 then raise exception 'DOCUMENT_INTAKE_INVALID_TYPE'; end if;
  if char_length(p_object_path) > 500 or p_object_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then raise exception 'DOCUMENT_INTAKE_INVALID_PATH'; end if;
  if p_sha256 !~ '^[A-Fa-f0-9]{64}$' then raise exception 'DOCUMENT_INTAKE_INVALID_SHA256'; end if;
  if char_length(trim(p_original_filename)) < 1 or char_length(trim(p_original_filename)) > 255 then raise exception 'DOCUMENT_INTAKE_INVALID_FILENAME'; end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then raise exception 'DOCUMENT_INTAKE_UNSUPPORTED_MIME'; end if;
  if p_byte_size < 1 or p_byte_size > 20971520 then raise exception 'DOCUMENT_INTAKE_INVALID_SIZE'; end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'private-documents' and name = p_object_path and owner_id = v_owner_id::text
  ) then
    raise exception 'DOCUMENT_INTAKE_STORAGE_OBJECT_NOT_OWNED';
  end if;

  select deletion_generation into v_deletion_generation
  from public.profiles where user_id = v_owner_id for share;
  if v_deletion_generation is null then raise exception 'DOCUMENT_INTAKE_PROFILE_MISSING'; end if;

  insert into public.documents (owner_id, label, document_type)
  values (v_owner_id, trim(p_label), nullif(trim(p_document_type), ''))
  returning id into v_document_id;

  insert into public.document_versions (
    owner_id, document_id, object_path, sha256, original_filename, mime_type, byte_size
  ) values (
    v_owner_id, v_document_id, p_object_path, lower(p_sha256), trim(p_original_filename), p_mime_type, p_byte_size
  ) returning id into v_document_version_id;

  update public.documents set latest_version_id = v_document_version_id
  where owner_id = v_owner_id and id = v_document_id;

  insert into public.jobs (kind, owner_id, dedupe_key, payload)
  values (
    'extract_document',
    v_owner_id,
    'extract-document:' || v_document_version_id::text,
    jsonb_build_object('documentVersionId', v_document_version_id, 'deletionGeneration', v_deletion_generation)
  ) returning id into v_job_id;

  insert into public.outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
  values (
    'document_intake_created',
    'document_version',
    v_document_version_id,
    jsonb_build_object('ownerId', v_owner_id, 'documentId', v_document_id, 'documentVersionId', v_document_version_id, 'jobId', v_job_id),
    'document-intake:' || v_document_version_id::text
  );

  document_id := v_document_id;
  document_version_id := v_document_version_id;
  job_id := v_job_id;
  return next;
end;
$$;

revoke all on function public.create_document_intake(text, text, text, text, text, text, bigint) from public, anon;
grant execute on function public.create_document_intake(text, text, text, text, text, text, bigint) to authenticated;

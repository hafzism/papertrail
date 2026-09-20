-- Owner-controlled document removal hides the document immediately, invalidates any
-- proposed/confirmed private evidence link, and prevents a leased extractor from
-- persisting a late result. The browser removes returned owner-scoped Storage paths.

drop policy if exists documents_owner_read on public.documents;
create policy documents_owner_read on public.documents for select using (owner_id = auth.uid() and deleted_at is null);

drop policy if exists document_versions_owner_read on public.document_versions;
create policy document_versions_owner_read on public.document_versions for select using (
  owner_id = auth.uid()
  and exists (
    select 1 from public.documents
    where documents.id = document_versions.document_id
      and documents.owner_id = auth.uid()
      and documents.deleted_at is null
  )
);

drop policy if exists document_extractions_owner_read on public.document_extractions;
create policy document_extractions_owner_read on public.document_extractions for select using (
  owner_id = auth.uid()
  and exists (
    select 1 from public.document_versions
    join public.documents on documents.id = document_versions.document_id
    where document_versions.id = document_extractions.document_version_id
      and document_versions.owner_id = auth.uid()
      and documents.deleted_at is null
  )
);

create or replace function public.begin_document_extraction(
  p_job_id uuid,
  p_fencing_token bigint,
  p_owner_id uuid,
  p_document_version_id uuid,
  p_deletion_generation integer
)
returns table (object_path text, mime_type text, original_filename text, byte_size bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update public.document_versions as version
  set extraction_state = 'processing'
  from public.documents as document
  join public.jobs as job on true
  join public.profiles as profile on profile.user_id = job.owner_id
  where version.id = p_document_version_id
    and version.document_id = document.id
    and document.owner_id = p_owner_id
    and document.deleted_at is null
    and version.owner_id = p_owner_id
    and version.extraction_state in ('pending', 'processing')
    and job.id = p_job_id
    and job.owner_id = p_owner_id
    and job.kind = 'extract_document'
    and job.state = 'running'
    and job.fencing_token = p_fencing_token
    and job.lease_expires_at > now()
    and job.payload->>'documentVersionId' = p_document_version_id::text
    and profile.deletion_generation = p_deletion_generation
  returning version.object_path, version.mime_type, version.original_filename, version.byte_size;
end;
$$;

create or replace function public.record_document_extraction(
  p_job_id uuid,
  p_fencing_token bigint,
  p_owner_id uuid,
  p_document_version_id uuid,
  p_deletion_generation integer,
  p_extractor_version text,
  p_state text,
  p_text_object_path text default null,
  p_text_excerpt text default null,
  p_page_count integer default null,
  p_uncertainty_flags jsonb default '[]'::jsonb,
  p_provenance jsonb default '{}'::jsonb
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_updated boolean := false;
begin
  if p_state not in ('completed', 'failed', 'needs_input') then raise exception 'DOCUMENT_EXTRACTION_INVALID_STATE'; end if;
  if char_length(p_extractor_version) < 1 or char_length(p_extractor_version) > 120 then raise exception 'DOCUMENT_EXTRACTION_INVALID_VERSION'; end if;
  if jsonb_typeof(p_uncertainty_flags) <> 'array' or jsonb_typeof(p_provenance) <> 'object' then raise exception 'DOCUMENT_EXTRACTION_INVALID_METADATA'; end if;
  if p_state = 'completed' and (p_text_object_path is null or p_text_excerpt is null or p_page_count is null) then raise exception 'DOCUMENT_EXTRACTION_COMPLETED_DATA_REQUIRED'; end if;
  if p_state <> 'completed' and (p_text_object_path is not null or p_text_excerpt is not null) then raise exception 'DOCUMENT_EXTRACTION_NONCOMPLETED_TEXT_FORBIDDEN'; end if;

  update public.document_versions as version
  set extraction_state = p_state,
      page_count = case when p_state = 'completed' then p_page_count else version.page_count end
  from public.documents as document
  join public.jobs as job on true
  join public.profiles as profile on profile.user_id = job.owner_id
  where version.id = p_document_version_id
    and version.document_id = document.id
    and document.owner_id = p_owner_id
    and document.deleted_at is null
    and version.owner_id = p_owner_id
    and version.extraction_state = 'processing'
    and job.id = p_job_id
    and job.owner_id = p_owner_id
    and job.kind = 'extract_document'
    and job.state = 'running'
    and job.fencing_token = p_fencing_token
    and job.lease_expires_at > now()
    and profile.deletion_generation = p_deletion_generation
  returning true into v_updated;
  if not coalesce(v_updated, false) then return false; end if;

  insert into public.document_extractions (
    owner_id, document_version_id, extractor_version, text_object_path, text_excerpt, page_count, uncertainty_flags, provenance
  ) values (
    p_owner_id, p_document_version_id, p_extractor_version, p_text_object_path, p_text_excerpt, p_page_count, p_uncertainty_flags, p_provenance
  ) on conflict (document_version_id, extractor_version) do nothing;
  return true;
end;
$$;

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
  where version.document_id = p_document_id
    and binding.document_version_id = version.id
    and binding.owner_id = v_owner_id
    and binding.binding_state <> 'needs_review';

  return query
  select
    coalesce(array_agg(distinct version.object_path) filter (where version.object_path is not null), '{}'::text[]),
    coalesce(array_agg(distinct extraction.text_object_path) filter (where extraction.text_object_path is not null), '{}'::text[])
  from public.document_versions as version
  left join public.document_extractions as extraction on extraction.document_version_id = version.id and extraction.owner_id = v_owner_id
  where version.document_id = p_document_id and version.owner_id = v_owner_id;
end;
$$;

revoke all on function public.remove_private_document(uuid) from public, anon;
grant execute on function public.remove_private_document(uuid) to authenticated;

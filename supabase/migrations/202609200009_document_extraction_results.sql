-- Extraction results are produced only by a fenced trusted worker. Private clients may read
-- their metadata but cannot write completion states, extracted text, or failure outcomes.

create table public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  document_version_id uuid not null,
  extractor_version text not null check (char_length(extractor_version) between 1 and 120),
  text_object_path text,
  text_excerpt text,
  page_count integer check (page_count > 0 and page_count <= 50),
  uncertainty_flags jsonb not null default '[]'::jsonb,
  provenance jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (owner_id, document_version_id) references public.document_versions(owner_id, id) on delete cascade,
  unique (document_version_id, extractor_version),
  check (
    (text_object_path is null and text_excerpt is null)
    or (text_object_path is not null and text_excerpt is not null)
  )
);

create index document_extractions_owner_version_idx on public.document_extractions (owner_id, document_version_id);

alter table public.document_extractions enable row level security;
create policy document_extractions_owner_read on public.document_extractions for select using (owner_id = auth.uid());
grant select on public.document_extractions to authenticated;

create or replace function public.begin_document_extraction(
  p_job_id uuid,
  p_fencing_token bigint,
  p_owner_id uuid,
  p_document_version_id uuid
)
returns table (object_path text, mime_type text, original_filename text, byte_size bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update public.document_versions as version
  set extraction_state = 'processing'
  from public.jobs as job
  where version.id = p_document_version_id
    and version.owner_id = p_owner_id
    and version.extraction_state in ('pending', 'processing')
    and job.id = p_job_id
    and job.owner_id = p_owner_id
    and job.kind = 'extract_document'
    and job.state = 'running'
    and job.fencing_token = p_fencing_token
    and job.lease_expires_at > now()
    and job.payload->>'documentVersionId' = p_document_version_id::text
  returning version.object_path, version.mime_type, version.original_filename, version.byte_size;
end;
$$;

create or replace function public.record_document_extraction(
  p_job_id uuid,
  p_fencing_token bigint,
  p_owner_id uuid,
  p_document_version_id uuid,
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
  if jsonb_typeof(p_uncertainty_flags) <> 'array' or jsonb_typeof(p_provenance) <> 'object' then
    raise exception 'DOCUMENT_EXTRACTION_INVALID_METADATA';
  end if;
  if p_state = 'completed' and (p_text_object_path is null or p_text_excerpt is null or p_page_count is null) then
    raise exception 'DOCUMENT_EXTRACTION_COMPLETED_DATA_REQUIRED';
  end if;
  if p_state <> 'completed' and (p_text_object_path is not null or p_text_excerpt is not null) then
    raise exception 'DOCUMENT_EXTRACTION_NONCOMPLETED_TEXT_FORBIDDEN';
  end if;

  update public.document_versions as version
  set extraction_state = p_state,
      page_count = case when p_state = 'completed' then p_page_count else version.page_count end
  from public.jobs as job
  where version.id = p_document_version_id
    and version.owner_id = p_owner_id
    and version.extraction_state = 'processing'
    and job.id = p_job_id
    and job.owner_id = p_owner_id
    and job.kind = 'extract_document'
    and job.state = 'running'
    and job.fencing_token = p_fencing_token
    and job.lease_expires_at > now()
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

revoke all on function public.begin_document_extraction(uuid, bigint, uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_document_extraction(uuid, bigint, uuid, uuid, text, text, text, text, integer, jsonb, jsonb) from public, anon, authenticated;

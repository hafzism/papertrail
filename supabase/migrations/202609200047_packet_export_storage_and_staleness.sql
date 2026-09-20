-- Private ZIP exports inherit their manifest's owner-only storage visibility and
-- stale/cleanup lifecycle when a bundled source document is removed.
drop policy if exists private_artifacts_record_owner_select on storage.objects;
create policy private_artifacts_record_owner_select on storage.objects for select using (
  bucket_id = 'private-artifacts' and (
    exists (select 1 from public.artifacts as artifact where artifact.object_path = name and artifact.owner_id = auth.uid())
    or exists (select 1 from public.packet_exports as packet_export where packet_export.object_path = name and packet_export.owner_id = auth.uid())
  )
);

create or replace function public.remove_private_document(p_document_id uuid)
returns table (document_object_paths text[], artifact_object_paths text[])
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then raise exception 'DOCUMENT_REMOVE_UNAUTHENTICATED'; end if;
  update public.documents set deleted_at = now(), updated_at = now() where id = p_document_id and owner_id = v_owner_id and deleted_at is null;
  if not found then raise exception 'DOCUMENT_REMOVE_NOT_AVAILABLE'; end if;
  update public.evidence_bindings as binding set binding_state = 'needs_review', confirmed_by = null, confirmed_at = null
  from public.document_versions as version where version.document_id = p_document_id and binding.document_version_id = version.id and binding.owner_id = v_owner_id and binding.binding_state <> 'needs_review';
  update public.artifacts as artifact set status = 'stale'
  where artifact.owner_id = v_owner_id and artifact.status <> 'stale' and exists (
    select 1 from public.document_versions as version where version.document_id = p_document_id and version.owner_id = v_owner_id and (
      exists (select 1 from jsonb_array_elements(coalesce(artifact.input_version_vector->'documents', '[]'::jsonb)) as document_vector where document_vector->>'id' = version.id::text)
      or (artifact.kind = 'filled_acroform' and artifact.input_version_vector->'inspection'->>'documentVersionId' = version.id::text)
    )
  );
  update public.packet_exports as packet_export set status = 'stale'
  from public.artifacts as artifact where packet_export.manifest_artifact_id = artifact.id and packet_export.owner_id = v_owner_id and artifact.status = 'stale'
    and exists (select 1 from public.document_versions as version where version.document_id = p_document_id and version.owner_id = v_owner_id and exists (select 1 from jsonb_array_elements(coalesce(artifact.input_version_vector->'documents', '[]'::jsonb)) as document_vector where document_vector->>'id' = version.id::text));
  return query select
    coalesce((select array_agg(distinct version.object_path order by version.object_path) from public.document_versions as version where version.document_id = p_document_id and version.owner_id = v_owner_id), '{}'::text[]),
    coalesce((select array_agg(distinct path order by path) from (
      select extraction.text_object_path as path from public.document_versions as version join public.document_extractions as extraction on extraction.document_version_id = version.id and extraction.owner_id = v_owner_id where version.document_id = p_document_id and version.owner_id = v_owner_id and extraction.text_object_path is not null
      union
      select artifact.object_path as path from public.artifacts as artifact where artifact.owner_id = v_owner_id and artifact.status = 'stale' and exists (select 1 from public.document_versions as version where version.document_id = p_document_id and version.owner_id = v_owner_id and (exists (select 1 from jsonb_array_elements(coalesce(artifact.input_version_vector->'documents', '[]'::jsonb)) as document_vector where document_vector->>'id' = version.id::text) or (artifact.kind = 'filled_acroform' and artifact.input_version_vector->'inspection'->>'documentVersionId' = version.id::text)))
      union
      select packet_export.object_path as path from public.packet_exports as packet_export join public.artifacts as artifact on artifact.id = packet_export.manifest_artifact_id where packet_export.owner_id = v_owner_id and packet_export.status = 'stale' and exists (select 1 from public.document_versions as version where version.document_id = p_document_id and version.owner_id = v_owner_id and exists (select 1 from jsonb_array_elements(coalesce(artifact.input_version_vector->'documents', '[]'::jsonb)) as document_vector where document_vector->>'id' = version.id::text))
    ) as derived), '{}'::text[]);
end;
$$;
revoke all on function public.remove_private_document(uuid) from public, anon;
grant execute on function public.remove_private_document(uuid) to authenticated;

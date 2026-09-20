-- Worker uploads use the service role, so storage.objects.owner_id is not the
-- browser owner. Read access is instead anchored to the owner-scoped artifact
-- record whose immutable object_path exactly matches the requested object.
create policy private_artifacts_record_owner_select on storage.objects for select using (
  bucket_id = 'private-artifacts'
  and exists (
    select 1 from public.artifacts as artifact
    where artifact.object_path = name and artifact.owner_id = auth.uid()
  )
);

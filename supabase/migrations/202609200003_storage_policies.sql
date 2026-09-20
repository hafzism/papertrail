-- Private Storage boundaries. Service credentials remain server-only; RLS protects authenticated Storage API access.

insert into storage.buckets (id, name, public) values
  ('private-documents', 'private-documents', false),
  ('private-artifacts', 'private-artifacts', false),
  ('private-receipts', 'private-receipts', false),
  ('private-audio', 'private-audio', false),
  ('quarantine-uploads', 'quarantine-uploads', false),
  ('published-notices', 'published-notices', true)
on conflict (id) do update set public = excluded.public;

create policy private_objects_owner_select on storage.objects for select using (
  bucket_id in ('private-documents', 'private-artifacts', 'private-receipts', 'private-audio', 'quarantine-uploads')
  and owner_id = (auth.uid())::text
);
create policy private_objects_owner_insert on storage.objects for insert with check (
  bucket_id in ('private-documents', 'private-artifacts', 'private-receipts', 'private-audio', 'quarantine-uploads')
  and owner_id = (auth.uid())::text
);
create policy private_objects_owner_update on storage.objects for update using (
  bucket_id in ('private-documents', 'private-artifacts', 'private-receipts', 'private-audio', 'quarantine-uploads')
  and owner_id = (auth.uid())::text
) with check (
  bucket_id in ('private-documents', 'private-artifacts', 'private-receipts', 'private-audio', 'quarantine-uploads')
  and owner_id = (auth.uid())::text
);
create policy private_objects_owner_delete on storage.objects for delete using (
  bucket_id in ('private-documents', 'private-artifacts', 'private-receipts', 'private-audio', 'quarantine-uploads')
  and owner_id = (auth.uid())::text
);
create policy published_notices_read on storage.objects for select using (bucket_id = 'published-notices');

grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;


insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'a@example.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'b@example.test'),
  ('00000000-0000-4000-8000-0000000000c3', 'moderator@example.test');

insert into public.profiles (user_id, display_name) values
  ('00000000-0000-4000-8000-0000000000a1', 'Person A'),
  ('00000000-0000-4000-8000-0000000000b2', 'Person B'),
  ('00000000-0000-4000-8000-0000000000c3', 'Moderator')
on conflict (user_id) do update set display_name = excluded.display_name;

insert into public.applications (id, owner_id, title) values
  ('10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', 'A application'),
  ('10000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2', 'B application');

insert into public.documents (id, owner_id, label) values
  ('20000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', 'A certificate'),
  ('20000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2', 'B certificate');

insert into public.document_versions (id, owner_id, document_id, object_path, sha256, original_filename, mime_type, byte_size) values
  ('30000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'owner-a/certificate.pdf', repeat('a', 64), 'certificate.pdf', 'application/pdf', 100),
  ('30000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', 'owner-b/certificate.pdf', repeat('a', 64), 'certificate.pdf', 'application/pdf', 100);

update public.documents set latest_version_id = case id
  when '20000000-0000-4000-8000-0000000000a1'::uuid then '30000000-0000-4000-8000-0000000000a1'::uuid
  when '20000000-0000-4000-8000-0000000000b2'::uuid then '30000000-0000-4000-8000-0000000000b2'::uuid
end;

insert into public.platform_roles (user_id, role, assigned_by) values
  ('00000000-0000-4000-8000-0000000000c3', 'notice_moderator', '00000000-0000-4000-8000-0000000000a1');

insert into public.budget_campaigns (id, name, allowed_nano, default_owner_limit_nano, default_run_limit_nano) values
  ('40000000-0000-4000-8000-000000000001', 'W1 test campaign', 500, 400, 300);
insert into public.budget_category_limits (campaign_id, category, allowed_nano) values
  ('40000000-0000-4000-8000-000000000001', 'model_inference', 300),
  ('40000000-0000-4000-8000-000000000001', 'live_voice', 100),
  ('40000000-0000-4000-8000-000000000001', 'transcription', 50),
  ('40000000-0000-4000-8000-000000000001', 'integration_smoke', 25),
  ('40000000-0000-4000-8000-000000000001', 'repair_contingency', 25);

insert into public.tracked_activities (id, owner_id, activity_type, title, source_application_id)
values ('70000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', 'admission', 'Candidate admission activity', '10000000-0000-4000-8000-0000000000a1');

insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('private-documents', 'owner-a/certificate.pdf', '00000000-0000-4000-8000-0000000000a1', '{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'),
  ('private-documents', 'owner-a/intake.pdf', '00000000-0000-4000-8000-0000000000a1', '{"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'),
  ('private-documents', 'owner-b/certificate.pdf', '00000000-0000-4000-8000-0000000000b2', '{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');

insert into public.jobs (id, kind, owner_id, dedupe_key, payload)
values ('80000000-0000-4000-8000-000000000001', 'extract_document', '00000000-0000-4000-8000-0000000000a1', 'document:30000000-0000-4000-8000-0000000000a1', '{"documentVersionId":"30000000-0000-4000-8000-0000000000a1"}');

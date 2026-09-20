-- URL registration is private and untrusted. A trusted worker may later capture a bounded
-- copy through a guarded network path; capture never makes a source authoritative.

create table public.private_source_captures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  private_snapshot_id uuid not null unique references public.private_notice_snapshots(id) on delete cascade,
  capture_state text not null check (capture_state in ('running', 'captured', 'needs_review', 'failed')),
  source_content_type text,
  content_sha256 text check (content_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  text_object_path text,
  text_excerpt text,
  error_code text,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade,
  check (
    (capture_state = 'running' and source_content_type is null and content_sha256 is null and text_object_path is null and text_excerpt is null and error_code is null)
    or (capture_state = 'captured' and source_content_type is not null and content_sha256 is not null and text_object_path is not null and text_excerpt is not null and error_code is null and captured_at is not null)
    or (capture_state in ('needs_review', 'failed') and error_code is not null and source_content_type is null and content_sha256 is null and text_object_path is null and text_excerpt is null)
  )
);
create index private_source_captures_owner_application_idx on public.private_source_captures (owner_id, application_id, created_at desc);
alter table public.private_source_captures enable row level security;
create policy private_source_captures_owner_read on public.private_source_captures for select using (owner_id = auth.uid());
revoke all on public.private_source_captures from public, anon, authenticated;
grant select on public.private_source_captures to authenticated;

create or replace function public.add_application_public_url_source(p_application_id uuid, p_source_url text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_snapshot_id uuid;
  v_job_id uuid;
  v_sequence bigint;
  v_deletion_generation integer;
  v_source_url text := trim(p_source_url);
  v_host text;
begin
  if v_owner_id is null then raise exception 'APPLICATION_SOURCE_UNAUTHENTICATED'; end if;
  if char_length(v_source_url) > 2048 or v_source_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/|\?|#|$)' then
    raise exception 'APPLICATION_SOURCE_INVALID_URL';
  end if;
  v_host := lower(substring(v_source_url from '^https://([^/:?#]+)'));
  if v_host is null or v_host = 'localhost' or v_host like '%.localhost' or v_host like '%.local' or v_host ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' then
    raise exception 'APPLICATION_SOURCE_DISALLOWED_HOST';
  end if;
  perform 1 from public.applications where id = p_application_id and owner_id = v_owner_id and lifecycle_state = 'draft' for update;
  if not found then raise exception 'APPLICATION_SOURCE_NOT_DRAFT_OR_NOT_FOUND'; end if;
  select deletion_generation into v_deletion_generation from public.profiles where user_id = v_owner_id for share;
  if v_deletion_generation is null then raise exception 'APPLICATION_SOURCE_PROFILE_MISSING'; end if;

  insert into public.private_notice_snapshots (owner_id, application_id, source_kind, source_status, source_url, content_sha256)
  values (v_owner_id, p_application_id, 'public_url', 'pending_capture', v_source_url, encode(digest(v_source_url, 'sha256'), 'hex'))
  returning id into v_snapshot_id;
  insert into public.jobs (kind, owner_id, dedupe_key, payload)
  values ('capture_public_source', v_owner_id, 'capture-public-source:' || v_snapshot_id::text,
    jsonb_build_object('privateSnapshotId', v_snapshot_id, 'deletionGeneration', v_deletion_generation))
  returning id into v_job_id;
  insert into public.outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
  values ('public_source_capture_queued', 'private_notice_snapshot', v_snapshot_id,
    jsonb_build_object('ownerId', v_owner_id, 'privateSnapshotId', v_snapshot_id, 'jobId', v_job_id),
    'public-source-capture:' || v_snapshot_id::text);
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (v_owner_id, p_application_id, v_sequence, 'owner', 'application_public_url_registered',
    'Public URL registered for safe capture', jsonb_build_object('privateSnapshotId', v_snapshot_id, 'jobId', v_job_id));
  return v_snapshot_id;
end;
$$;

create or replace function public.begin_public_source_capture(p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_private_snapshot_id uuid, p_deletion_generation integer)
returns table (source_url text) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source_url text;
begin
  select snapshot.source_url into v_source_url
  from public.private_notice_snapshots as snapshot
  join public.jobs as job on job.id = p_job_id
  join public.profiles as profile on profile.user_id = p_owner_id
  where snapshot.id = p_private_snapshot_id and snapshot.owner_id = p_owner_id
    and snapshot.source_kind = 'public_url' and snapshot.source_status = 'pending_capture'
    and job.owner_id = p_owner_id and job.kind = 'capture_public_source' and job.state = 'running'
    and job.fencing_token = p_fencing_token and job.lease_expires_at > now()
    and job.payload->>'privateSnapshotId' = p_private_snapshot_id::text
    and (job.payload->>'deletionGeneration')::integer = p_deletion_generation
    and profile.deletion_generation = p_deletion_generation
  for update of snapshot;
  if v_source_url is null then return; end if;
  insert into public.private_source_captures (owner_id, application_id, private_snapshot_id, capture_state)
  select owner_id, application_id, id, 'running' from public.private_notice_snapshots where id = p_private_snapshot_id
  on conflict (private_snapshot_id) do update set capture_state = 'running', error_code = null, updated_at = now()
    where public.private_source_captures.capture_state in ('failed', 'needs_review');
  return query select v_source_url;
end;
$$;

create or replace function public.record_public_source_capture(
  p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_private_snapshot_id uuid, p_deletion_generation integer,
  p_state text, p_source_content_type text default null, p_content_sha256 text default null,
  p_text_object_path text default null, p_text_excerpt text default null, p_error_code text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_updated boolean := false;
begin
  if p_state not in ('captured', 'needs_review', 'failed') then raise exception 'PUBLIC_SOURCE_CAPTURE_INVALID_STATE'; end if;
  if p_state = 'captured' and (p_source_content_type is null or p_content_sha256 is null or p_text_object_path is null or p_text_excerpt is null or p_error_code is not null) then
    raise exception 'PUBLIC_SOURCE_CAPTURE_DATA_REQUIRED';
  end if;
  if p_state <> 'captured' and (p_error_code is null or p_source_content_type is not null or p_content_sha256 is not null or p_text_object_path is not null or p_text_excerpt is not null) then
    raise exception 'PUBLIC_SOURCE_CAPTURE_FAILURE_METADATA_INVALID';
  end if;
  update public.private_source_captures as capture
  set capture_state = p_state, source_content_type = p_source_content_type, content_sha256 = p_content_sha256,
      text_object_path = p_text_object_path, text_excerpt = p_text_excerpt, error_code = p_error_code,
      captured_at = case when p_state = 'captured' then now() else null end, updated_at = now()
  from public.jobs as job join public.profiles as profile on profile.user_id = p_owner_id
  where capture.private_snapshot_id = p_private_snapshot_id and capture.owner_id = p_owner_id and capture.capture_state = 'running'
    and job.id = p_job_id and job.owner_id = p_owner_id and job.kind = 'capture_public_source' and job.state = 'running'
    and job.fencing_token = p_fencing_token and job.lease_expires_at > now() and profile.deletion_generation = p_deletion_generation
  returning true into v_updated;
  return coalesce(v_updated, false);
end;
$$;

revoke all on function public.begin_public_source_capture(uuid, bigint, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.record_public_source_capture(uuid, bigint, uuid, uuid, integer, text, text, text, text, text, text) from public, anon, authenticated;

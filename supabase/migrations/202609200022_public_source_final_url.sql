-- A redirected capture must retain the final reviewed URL as well as its immutable
-- content hash. The original registered URL remains in private_notice_snapshots.

alter table public.private_source_captures add column final_url text;

update public.private_source_captures as capture
set final_url = snapshot.source_url
from public.private_notice_snapshots as snapshot
where capture.private_snapshot_id = snapshot.id
  and capture.capture_state = 'captured'
  and capture.final_url is null;

alter table public.private_source_captures drop constraint private_source_captures_check;
alter table public.private_source_captures add constraint private_source_captures_check check (
  (capture_state = 'running' and source_content_type is null and final_url is null and content_sha256 is null and text_object_path is null and text_excerpt is null and error_code is null)
  or (capture_state = 'captured' and source_content_type is not null and final_url ~ '^https://[^[:space:]]{1,2040}$' and content_sha256 is not null and text_object_path is not null and text_excerpt is not null and error_code is null and captured_at is not null)
  or (capture_state in ('needs_review', 'failed') and error_code is not null and source_content_type is null and final_url is null and content_sha256 is null and text_object_path is null and text_excerpt is null)
);

drop function public.record_public_source_capture(uuid, bigint, uuid, uuid, integer, text, text, text, text, text, text);
create function public.record_public_source_capture(
  p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_private_snapshot_id uuid, p_deletion_generation integer,
  p_state text, p_final_url text default null, p_source_content_type text default null, p_content_sha256 text default null,
  p_text_object_path text default null, p_text_excerpt text default null, p_error_code text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_updated boolean := false;
begin
  if p_state not in ('captured', 'needs_review', 'failed') then raise exception 'PUBLIC_SOURCE_CAPTURE_INVALID_STATE'; end if;
  if p_state = 'captured' and (p_final_url is null or p_source_content_type is null or p_content_sha256 is null or p_text_object_path is null or p_text_excerpt is null or p_error_code is not null) then
    raise exception 'PUBLIC_SOURCE_CAPTURE_DATA_REQUIRED';
  end if;
  if p_state <> 'captured' and (p_final_url is not null or p_error_code is null or p_source_content_type is not null or p_content_sha256 is not null or p_text_object_path is not null or p_text_excerpt is not null) then
    raise exception 'PUBLIC_SOURCE_CAPTURE_FAILURE_METADATA_INVALID';
  end if;
  update public.private_source_captures as capture
  set capture_state = p_state, final_url = p_final_url, source_content_type = p_source_content_type, content_sha256 = p_content_sha256,
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

revoke all on function public.record_public_source_capture(uuid, bigint, uuid, uuid, integer, text, text, text, text, text, text, text) from public, anon, authenticated;

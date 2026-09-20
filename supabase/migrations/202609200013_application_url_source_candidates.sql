-- URL registration is deliberately separate from retrieval. A user can retain a potential
-- public source without the browser or database treating it as fetched, trusted, or authoritative.

alter table public.private_notice_snapshots
  alter column captured_text drop not null,
  add column source_url text;

alter table public.private_notice_snapshots
  drop constraint private_notice_snapshots_source_kind_check,
  drop constraint private_notice_snapshots_source_status_check;

alter table public.private_notice_snapshots
  add constraint private_notice_snapshots_source_kind_check
    check (source_kind in ('text_description', 'public_url')),
  add constraint private_notice_snapshots_source_status_check
    check (source_status in ('unresolved', 'pending_capture')),
  add constraint private_notice_snapshots_source_shape_check check (
    (source_kind = 'text_description' and source_status = 'unresolved' and captured_text is not null and source_url is null)
    or
    (source_kind = 'public_url' and source_status = 'pending_capture' and captured_text is null and source_url is not null)
  );

create or replace function public.add_application_public_url_source(
  p_application_id uuid,
  p_source_url text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_snapshot_id uuid;
  v_sequence bigint;
  v_source_url text := trim(p_source_url);
  v_host text;
begin
  if v_owner_id is null then raise exception 'APPLICATION_SOURCE_UNAUTHENTICATED'; end if;
  if char_length(v_source_url) > 2048
    or v_source_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/|\?|#|$)' then
    raise exception 'APPLICATION_SOURCE_INVALID_URL';
  end if;
  v_host := lower(substring(v_source_url from '^https://([^/:?#]+)'));
  if v_host is null or v_host = 'localhost' or v_host like '%.localhost' or v_host like '%.local'
    or v_host ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' then
    raise exception 'APPLICATION_SOURCE_DISALLOWED_HOST';
  end if;

  -- Locking preserves one monotonic event sequence while proving owner and draft scope.
  perform 1 from public.applications
    where id = p_application_id and owner_id = v_owner_id and lifecycle_state = 'draft'
    for update;
  if not found then raise exception 'APPLICATION_SOURCE_NOT_DRAFT_OR_NOT_FOUND'; end if;

  insert into public.private_notice_snapshots (
    owner_id, application_id, source_kind, source_status, source_url, content_sha256
  ) values (
    v_owner_id, p_application_id, 'public_url', 'pending_capture', v_source_url,
    encode(digest(v_source_url, 'sha256'), 'hex')
  ) returning id into v_snapshot_id;

  select coalesce(max(sequence), 0) + 1 into v_sequence
    from public.application_events where application_id = p_application_id;
  insert into public.application_events (
    owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids
  ) values (
    v_owner_id, p_application_id, v_sequence, 'owner', 'application_public_url_registered',
    'Public URL registered for safe capture', jsonb_build_object('privateSnapshotId', v_snapshot_id)
  );

  return v_snapshot_id;
end;
$$;

revoke all on function public.add_application_public_url_source(uuid, text) from public, anon;
grant execute on function public.add_application_public_url_source(uuid, text) to authenticated;

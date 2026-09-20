-- An owner-provided description is useful context, but it is not an authoritative notice.
-- Keep it private, immutable, and visibly unresolved until a later source-capture workflow
-- can establish the source and extract reviewable requirements.

create table public.private_notice_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  source_kind text not null check (source_kind in ('text_description')),
  source_status text not null check (source_status in ('unresolved')),
  captured_text text not null check (char_length(captured_text) between 1 and 12000),
  content_sha256 text not null check (content_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);

create index private_notice_snapshots_owner_application_idx
  on public.private_notice_snapshots (owner_id, application_id, created_at desc);

alter table public.private_notice_snapshots enable row level security;
create policy private_notice_snapshots_owner_read on public.private_notice_snapshots
  for select using (owner_id = auth.uid());

revoke all on public.private_notice_snapshots from public, anon, authenticated;
grant select on public.private_notice_snapshots to authenticated;

create or replace function public.add_application_text_description(
  p_application_id uuid,
  p_description text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_snapshot_id uuid;
  v_sequence bigint;
  v_description text := trim(p_description);
begin
  if v_owner_id is null then raise exception 'APPLICATION_SOURCE_UNAUTHENTICATED'; end if;
  if char_length(v_description) < 1 or char_length(v_description) > 12000 then
    raise exception 'APPLICATION_SOURCE_INVALID_DESCRIPTION';
  end if;

  -- This row lock serializes the event sequence for the application as well as checking ownership.
  perform 1 from public.applications
    where id = p_application_id and owner_id = v_owner_id and lifecycle_state = 'draft'
    for update;
  if not found then raise exception 'APPLICATION_SOURCE_NOT_DRAFT_OR_NOT_FOUND'; end if;

  insert into public.private_notice_snapshots (
    owner_id, application_id, source_kind, source_status, captured_text, content_sha256
  ) values (
    v_owner_id, p_application_id, 'text_description', 'unresolved', v_description,
    encode(digest(v_description, 'sha256'), 'hex')
  ) returning id into v_snapshot_id;

  select coalesce(max(sequence), 0) + 1 into v_sequence
    from public.application_events where application_id = p_application_id;
  insert into public.application_events (
    owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids
  ) values (
    v_owner_id, p_application_id, v_sequence, 'owner', 'application_text_description_added',
    'Unresolved text description added', jsonb_build_object('privateSnapshotId', v_snapshot_id)
  );

  return v_snapshot_id;
end;
$$;

revoke all on function public.add_application_text_description(uuid, text) from public, anon;
grant execute on function public.add_application_text_description(uuid, text) to authenticated;

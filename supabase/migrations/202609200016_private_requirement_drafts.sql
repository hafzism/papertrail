-- Private source notes/captures may suggest work items, but cannot silently become
-- authoritative eligibility rules. These immutable drafts remain unresolved.

create table public.private_requirement_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  private_snapshot_id uuid not null references public.private_notice_snapshots(id) on delete cascade,
  logical_key text not null check (logical_key ~ '^[a-z][a-z0-9_.-]{0,119}$'),
  kind text not null check (kind in ('document', 'field', 'eligibility', 'deadline', 'format', 'fee', 'declaration')),
  label text not null check (char_length(label) between 1 and 500),
  citation_excerpt text not null check (char_length(citation_excerpt) between 1 and 4000),
  review_state text not null default 'unresolved' check (review_state in ('unresolved', 'proposed', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);
create index private_requirement_versions_owner_application_idx on public.private_requirement_versions (owner_id, application_id, created_at desc);
alter table public.private_requirement_versions enable row level security;
create policy private_requirement_versions_owner_read on public.private_requirement_versions for select using (owner_id = auth.uid());
revoke all on public.private_requirement_versions from public, anon, authenticated;
grant select on public.private_requirement_versions to authenticated;

create or replace function public.add_private_requirement_draft(
  p_application_id uuid,
  p_private_snapshot_id uuid,
  p_logical_key text,
  p_kind text,
  p_label text,
  p_citation_excerpt text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_requirement_id uuid;
  v_sequence bigint;
begin
  if v_owner_id is null then raise exception 'PRIVATE_REQUIREMENT_UNAUTHENTICATED'; end if;
  if trim(p_logical_key) !~ '^[a-z][a-z0-9_.-]{0,119}$' then raise exception 'PRIVATE_REQUIREMENT_INVALID_KEY'; end if;
  if p_kind not in ('document', 'field', 'eligibility', 'deadline', 'format', 'fee', 'declaration') then raise exception 'PRIVATE_REQUIREMENT_INVALID_KIND'; end if;
  if char_length(trim(p_label)) < 1 or char_length(trim(p_label)) > 500 then raise exception 'PRIVATE_REQUIREMENT_INVALID_LABEL'; end if;
  if char_length(trim(p_citation_excerpt)) < 1 or char_length(trim(p_citation_excerpt)) > 4000 then raise exception 'PRIVATE_REQUIREMENT_INVALID_CITATION'; end if;
  perform 1 from public.applications where id = p_application_id and owner_id = v_owner_id and lifecycle_state = 'draft' for update;
  if not found then raise exception 'PRIVATE_REQUIREMENT_APPLICATION_NOT_DRAFT_OR_NOT_FOUND'; end if;
  perform 1 from public.private_notice_snapshots where id = p_private_snapshot_id and owner_id = v_owner_id and application_id = p_application_id;
  if not found then raise exception 'PRIVATE_REQUIREMENT_SOURCE_NOT_FOUND'; end if;

  insert into public.private_requirement_versions (owner_id, application_id, private_snapshot_id, logical_key, kind, label, citation_excerpt)
  values (v_owner_id, p_application_id, p_private_snapshot_id, trim(p_logical_key), p_kind, trim(p_label), trim(p_citation_excerpt))
  returning id into v_requirement_id;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (v_owner_id, p_application_id, v_sequence, 'owner', 'private_requirement_draft_added',
    'Unresolved private requirement draft added', jsonb_build_object('privateRequirementId', v_requirement_id, 'privateSnapshotId', p_private_snapshot_id));
  return v_requirement_id;
end;
$$;

revoke all on function public.add_private_requirement_draft(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.add_private_requirement_draft(uuid, uuid, text, text, text, text) to authenticated;

-- A private requirement remains unresolved, but its citation identifies the immutable
-- source version used to create it. This enables later review without elevating a
-- private note or captured URL to an authoritative requirement.

alter table public.private_requirement_versions
  add column citation_source_hash text,
  add column citation_basis text;

update public.private_requirement_versions as requirement
set citation_source_hash = case
      when snapshot.source_kind = 'public_url' and capture.capture_state = 'captured' then capture.content_sha256
      else snapshot.content_sha256
    end,
    citation_basis = case
      when snapshot.source_kind = 'text_description' then 'owner_text'
      when capture.capture_state = 'captured' then 'captured_public_copy'
      else 'registered_url'
    end
from public.private_notice_snapshots as snapshot
left join public.private_source_captures as capture on capture.private_snapshot_id = snapshot.id
where requirement.private_snapshot_id = snapshot.id;

alter table public.private_requirement_versions
  alter column citation_source_hash set not null,
  alter column citation_basis set not null,
  add constraint private_requirement_versions_citation_source_hash_check check (citation_source_hash ~ '^[A-Fa-f0-9]{64}$'),
  add constraint private_requirement_versions_citation_basis_check check (citation_basis in ('owner_text', 'captured_public_copy', 'registered_url'));

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
  v_citation_source_hash text;
  v_citation_basis text;
begin
  if v_owner_id is null then raise exception 'PRIVATE_REQUIREMENT_UNAUTHENTICATED'; end if;
  if trim(p_logical_key) !~ '^[a-z][a-z0-9_.-]{0,119}$' then raise exception 'PRIVATE_REQUIREMENT_INVALID_KEY'; end if;
  if p_kind not in ('document', 'field', 'eligibility', 'deadline', 'format', 'fee', 'declaration') then raise exception 'PRIVATE_REQUIREMENT_INVALID_KIND'; end if;
  if char_length(trim(p_label)) < 1 or char_length(trim(p_label)) > 500 then raise exception 'PRIVATE_REQUIREMENT_INVALID_LABEL'; end if;
  if char_length(trim(p_citation_excerpt)) < 1 or char_length(trim(p_citation_excerpt)) > 4000 then raise exception 'PRIVATE_REQUIREMENT_INVALID_CITATION'; end if;
  perform 1 from public.applications where id = p_application_id and owner_id = v_owner_id and lifecycle_state = 'draft' for update;
  if not found then raise exception 'PRIVATE_REQUIREMENT_APPLICATION_NOT_DRAFT_OR_NOT_FOUND'; end if;

  select
    case when snapshot.source_kind = 'public_url' and capture.capture_state = 'captured' then capture.content_sha256 else snapshot.content_sha256 end,
    case
      when snapshot.source_kind = 'text_description' then 'owner_text'
      when capture.capture_state = 'captured' then 'captured_public_copy'
      else 'registered_url'
    end
  into v_citation_source_hash, v_citation_basis
  from public.private_notice_snapshots as snapshot
  left join public.private_source_captures as capture on capture.private_snapshot_id = snapshot.id
  where snapshot.id = p_private_snapshot_id and snapshot.owner_id = v_owner_id and snapshot.application_id = p_application_id;
  if v_citation_source_hash is null then raise exception 'PRIVATE_REQUIREMENT_SOURCE_NOT_FOUND'; end if;

  insert into public.private_requirement_versions (
    owner_id, application_id, private_snapshot_id, logical_key, kind, label, citation_excerpt, citation_source_hash, citation_basis
  ) values (
    v_owner_id, p_application_id, p_private_snapshot_id, trim(p_logical_key), p_kind, trim(p_label), trim(p_citation_excerpt), v_citation_source_hash, v_citation_basis
  ) returning id into v_requirement_id;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (v_owner_id, p_application_id, v_sequence, 'owner', 'private_requirement_draft_added',
    'Unresolved private requirement draft added', jsonb_build_object('privateRequirementId', v_requirement_id, 'privateSnapshotId', p_private_snapshot_id));
  return v_requirement_id;
end;
$$;

revoke all on function public.add_private_requirement_draft(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.add_private_requirement_draft(uuid, uuid, text, text, text, text) to authenticated;

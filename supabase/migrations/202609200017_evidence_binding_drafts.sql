-- An evidence binding is a reviewable owner proposal, not an automatic eligibility finding.

create table public.evidence_bindings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  private_requirement_id uuid not null references public.private_requirement_versions(id) on delete cascade,
  document_version_id uuid not null,
  binding_state text not null default 'proposed' check (binding_state in ('proposed', 'confirmed', 'rejected', 'needs_review')),
  explanation text not null check (char_length(explanation) between 1 and 4000),
  confirmed_by uuid references public.profiles(user_id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade,
  foreign key (owner_id, document_version_id) references public.document_versions(owner_id, id) on delete cascade,
  unique (private_requirement_id, document_version_id),
  check ((binding_state = 'confirmed' and confirmed_by is not null and confirmed_at is not null) or (binding_state <> 'confirmed' and confirmed_by is null and confirmed_at is null))
);
create index evidence_bindings_owner_application_idx on public.evidence_bindings (owner_id, application_id, created_at desc);
alter table public.evidence_bindings enable row level security;
create policy evidence_bindings_owner_read on public.evidence_bindings for select using (owner_id = auth.uid());
revoke all on public.evidence_bindings from public, anon, authenticated;
grant select on public.evidence_bindings to authenticated;

create or replace function public.add_evidence_binding_draft(
  p_application_id uuid,
  p_private_requirement_id uuid,
  p_document_version_id uuid,
  p_explanation text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_binding_id uuid;
  v_sequence bigint;
begin
  if v_owner_id is null then raise exception 'EVIDENCE_BINDING_UNAUTHENTICATED'; end if;
  if char_length(trim(p_explanation)) < 1 or char_length(trim(p_explanation)) > 4000 then raise exception 'EVIDENCE_BINDING_INVALID_EXPLANATION'; end if;
  perform 1 from public.applications where id = p_application_id and owner_id = v_owner_id and lifecycle_state = 'draft' for update;
  if not found then raise exception 'EVIDENCE_BINDING_APPLICATION_NOT_DRAFT_OR_NOT_FOUND'; end if;
  perform 1 from public.private_requirement_versions where id = p_private_requirement_id and owner_id = v_owner_id and application_id = p_application_id;
  if not found then raise exception 'EVIDENCE_BINDING_REQUIREMENT_NOT_FOUND'; end if;
  perform 1 from public.document_versions where id = p_document_version_id and owner_id = v_owner_id and extraction_state = 'completed';
  if not found then raise exception 'EVIDENCE_BINDING_DOCUMENT_NOT_COMPLETED_OR_NOT_FOUND'; end if;

  insert into public.evidence_bindings (owner_id, application_id, private_requirement_id, document_version_id, explanation)
  values (v_owner_id, p_application_id, p_private_requirement_id, p_document_version_id, trim(p_explanation))
  returning id into v_binding_id;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (v_owner_id, p_application_id, v_sequence, 'owner', 'evidence_binding_draft_added',
    'Proposed evidence binding added', jsonb_build_object('evidenceBindingId', v_binding_id, 'privateRequirementId', p_private_requirement_id, 'documentVersionId', p_document_version_id));
  return v_binding_id;
end;
$$;

revoke all on function public.add_evidence_binding_draft(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.add_evidence_binding_draft(uuid, uuid, uuid, text) to authenticated;

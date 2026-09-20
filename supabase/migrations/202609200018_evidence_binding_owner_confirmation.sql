-- Owner confirmation is limited to the proposed document association. It does not certify
-- source rules, eligibility, or an external submission.

create or replace function public.confirm_evidence_binding(p_evidence_binding_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_application_id uuid;
  v_sequence bigint;
begin
  if v_owner_id is null then raise exception 'EVIDENCE_BINDING_CONFIRM_UNAUTHENTICATED'; end if;
  update public.evidence_bindings
  set binding_state = 'confirmed', confirmed_by = v_owner_id, confirmed_at = now()
  where id = p_evidence_binding_id and owner_id = v_owner_id and binding_state = 'proposed'
  returning application_id into v_application_id;
  if v_application_id is null then raise exception 'EVIDENCE_BINDING_CONFIRM_NOT_AVAILABLE'; end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (v_owner_id, v_application_id, v_sequence, 'owner', 'evidence_binding_owner_confirmed',
    'Owner confirmed proposed evidence binding', jsonb_build_object('evidenceBindingId', p_evidence_binding_id));
  return true;
end;
$$;

revoke all on function public.confirm_evidence_binding(uuid) from public, anon;
grant execute on function public.confirm_evidence_binding(uuid) to authenticated;

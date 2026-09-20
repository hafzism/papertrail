-- A receipt proves an acknowledgement, not approval, enrollment, issuance, or
-- consent to monitoring. The local reference receipt therefore creates only a
-- paused candidate activity, which the owner must explicitly confirm later.
create or replace function public.create_reference_receipt_candidate_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_title text; v_activity_id uuid; v_evidence_id uuid;
begin
  select title into v_title from public.applications where id = new.application_id and owner_id = new.owner_id;
  if v_title is null then return new; end if;
  insert into public.tracked_activities (
    owner_id, activity_type, title, scope_json, confirmation_state, tracking_state, source_application_id
  ) values (
    new.owner_id, 'application_followup', left('Follow-up for ' || v_title, 200),
    jsonb_build_object('origin', 'fictional_reference_portal_receipt', 'referenceCode', new.reference_code),
    'candidate', 'paused', new.application_id
  ) returning id into v_activity_id;
  insert into public.activity_evidence (owner_id, activity_id, evidence_kind, supported_facts, confirmation_actor)
    values (new.owner_id, v_activity_id, 'submission_evidence', jsonb_build_object('referenceCode', new.reference_code, 'receiptId', new.id, 'statement', 'A fictional acknowledgement is not proof of approval, enrollment, or issuance.'), 'system')
    returning id into v_evidence_id;
  insert into public.notifications (owner_id, activity_id, event_type, dedupe_key, minimal_text, deep_link, actionable_status)
    values (new.owner_id, v_activity_id, 'candidate_activity_detected', 'reference-receipt-candidate:' || new.id::text,
      'A fictional receipt created a candidate follow-up activity. Confirm it only if you want to track later steps; it does not prove approval or enrollment.', '/app/activities/' || v_activity_id::text, 'needs_review');
  return new;
end;
$$;
create trigger reference_portal_receipts_create_candidate_activity
  after insert on public.reference_portal_receipts for each row execute procedure public.create_reference_receipt_candidate_activity();

create or replace function public.confirm_candidate_tracked_activity(p_activity_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then raise exception 'ACTIVITY_AUTH_REQUIRED'; end if;
  update public.tracked_activities set confirmation_state = 'owner_confirmed'
    where id = p_activity_id and owner_id = v_owner_id and confirmation_state = 'candidate';
  if not found then raise exception 'ACTIVITY_NOT_CONFIRMABLE'; end if;
  update public.activity_evidence set confirmation_actor = 'owner', confirmed_at = now()
    where owner_id = v_owner_id and activity_id = p_activity_id and evidence_kind in ('submission_evidence', 'owner_record') and confirmed_at is null;
  return true;
end;
$$;
revoke all on function public.confirm_candidate_tracked_activity(uuid) from public, anon;
grant execute on function public.confirm_candidate_tracked_activity(uuid) to authenticated;

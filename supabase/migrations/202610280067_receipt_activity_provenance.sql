-- A submission-evidence row must carry the immutable receipt identifier.
create or replace function public.create_reference_receipt_candidate_activity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_title text;v_activity uuid;
begin
  select title into v_title from public.applications where id=new.application_id and owner_id=new.owner_id;
  if v_title is null then return new;end if;
  insert into public.tracked_activities(owner_id,activity_type,title,scope_json,confirmation_state,tracking_state,source_application_id)
    values(new.owner_id,'application_followup',left('Follow-up for '||v_title,200),jsonb_build_object('origin','fictional_reference_portal_receipt','referenceCode',new.reference_code),'candidate','paused',new.application_id) returning id into v_activity;
  insert into public.activity_evidence(owner_id,activity_id,evidence_kind,evidence_version_id,supported_facts,confirmation_actor)
    values(new.owner_id,v_activity,'submission_evidence',new.id,jsonb_build_object('referenceCode',new.reference_code,'receiptId',new.id,'statement','A fictional acknowledgement is not proof of approval, enrollment, or issuance.'),'system');
  insert into public.notifications(owner_id,activity_id,event_type,dedupe_key,minimal_text,deep_link,actionable_status)
    values(new.owner_id,v_activity,'candidate_activity_detected','reference-receipt-candidate:'||new.id,'A fictional receipt created a candidate follow-up activity. Confirm it before tracking later steps.','/app/activities/'||v_activity,'needs_review');
  return new;
end;$$;
revoke all on function public.create_reference_receipt_candidate_activity() from public,anon,authenticated;

-- SET NULL on a composite owner reference must retain the non-null owner.
alter table public.tracked_activities drop constraint tracked_activities_owner_id_source_application_id_fkey;
alter table public.tracked_activities add constraint tracked_activities_owner_id_source_application_id_fkey foreign key(owner_id,source_application_id) references public.applications(owner_id,id) on delete set null(source_application_id);

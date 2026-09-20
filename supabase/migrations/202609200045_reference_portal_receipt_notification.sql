-- A local reference-portal receipt is a private application event, so surface it
-- through the existing owner inbox without exposing any content publicly.
create or replace function public.notify_reference_portal_receipt()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (owner_id, application_id, event_type, dedupe_key, minimal_text, deep_link, actionable_status)
  values (
    new.owner_id, new.application_id, 'reference_portal_demo_acknowledged', 'reference-portal-receipt:' || new.changeset_id::text,
    'A fictional local reference-portal acknowledgement was recorded. It is not an institutional submission.',
    '/app/applications/' || new.application_id::text, 'review_recorded'
  ) on conflict (owner_id, dedupe_key) do nothing;
  return new;
end;
$$;
create trigger reference_portal_receipt_notify
  after insert on public.reference_portal_receipts
  for each row execute procedure public.notify_reference_portal_receipt();

-- A newly recorded activity action receives an in-app alert. The action itself
-- remains the authority; this notification does not turn an owner reminder
-- into a verified notice or external obligation.
create or replace function public.notify_owner_followup_action_created()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (owner_id, activity_id, followup_action_id, event_type, dedupe_key, minimal_text, deep_link, actionable_status)
    values (
      new.owner_id, new.activity_id, new.id, 'followup_action_recorded',
      'followup-action-recorded:' || new.id::text,
      'A private follow-up action was recorded. Review its status and details before relying on it.',
      '/app/activities/' || new.activity_id::text, 'needs_review'
    ) on conflict (owner_id, dedupe_key) do nothing;
  return new;
end;
$$;
create trigger followup_actions_notify_owner_after_insert
  after insert on public.followup_actions for each row execute procedure public.notify_owner_followup_action_created();

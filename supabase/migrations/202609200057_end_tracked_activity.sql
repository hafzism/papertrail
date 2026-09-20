-- Ending an activity prevents future follow-up delivery without rewriting its
-- history or claiming that existing actions were completed externally.
create or replace function public.end_tracked_activity(p_activity_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then raise exception 'ACTIVITY_AUTH_REQUIRED'; end if;
  update public.tracked_activities set tracking_state = 'ended'
    where id = p_activity_id and owner_id = v_owner_id and tracking_state <> 'ended';
  if not found then raise exception 'ACTIVITY_NOT_ENDABLE'; end if;
  update public.activity_subscriptions set enabled = false, stopped_at = now()
    where owner_id = v_owner_id and activity_id = p_activity_id and enabled;
  insert into public.notifications (owner_id, activity_id, event_type, dedupe_key, minimal_text, deep_link, actionable_status)
    values (v_owner_id, p_activity_id, 'activity_ended', 'activity-ended:' || p_activity_id::text,
      'Follow-up tracking was ended for this private activity. Existing records are retained for review.', '/app/activities/' || p_activity_id::text, 'recorded')
    on conflict (owner_id, dedupe_key) do nothing;
  return true;
end;
$$;
revoke all on function public.end_tracked_activity(uuid) from public, anon;
grant execute on function public.end_tracked_activity(uuid) to authenticated;

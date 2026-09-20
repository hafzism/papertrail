-- Linked private-chat text enters the same owner-owned state model. It never
-- selects an application, confirms a fact, or approves an external action.
create table public.telegram_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  telegram_update_id bigint not null unique,
  telegram_chat_id bigint not null,
  body text not null check (char_length(body) between 1 and 4000),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index telegram_inbound_messages_owner_received_idx on public.telegram_inbound_messages (owner_id, received_at desc);
alter table public.telegram_inbound_messages enable row level security;
create policy telegram_inbound_messages_owner_read on public.telegram_inbound_messages for select using (owner_id = auth.uid());
revoke all on public.telegram_inbound_messages from public, anon, authenticated;
grant select on public.telegram_inbound_messages to authenticated;

create or replace function public.ingest_telegram_private_text_update(
  p_update_id bigint, p_chat_id bigint, p_chat_type text, p_username text default null, p_text text default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner_id uuid; v_body text := btrim(coalesce(p_text, ''));
begin
  insert into public.telegram_inbound_updates (telegram_update_id, chat_id, update_kind, outcome_code)
    values (p_update_id, p_chat_id, 'message', 'received') on conflict (telegram_update_id) do nothing;
  if not found then return 'duplicate'; end if;
  if p_chat_type <> 'private' then
    update public.telegram_inbound_updates set handled_at = now(), outcome_code = 'GROUP_OR_NONPRIVATE_REJECTED' where telegram_update_id = p_update_id;
    return 'group_rejected';
  end if;
  select owner_id into v_owner_id from public.telegram_channel_links where telegram_chat_id = p_chat_id and unlinked_at is null;
  if v_owner_id is null then
    update public.telegram_inbound_updates set handled_at = now(), outcome_code = 'UNLINKED_CHAT_IGNORED' where telegram_update_id = p_update_id;
    return 'unlinked';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 4000 then
    update public.telegram_inbound_updates set handled_at = now(), outcome_code = 'TEXT_EMPTY_OR_TOO_LARGE' where telegram_update_id = p_update_id;
    return 'invalid_text';
  end if;
  insert into public.telegram_inbound_messages (owner_id, telegram_update_id, telegram_chat_id, body)
    values (v_owner_id, p_update_id, p_chat_id, v_body);
  insert into public.notifications (owner_id, activity_id, event_type, dedupe_key, minimal_text, deep_link, actionable_status)
    select v_owner_id, activity.id, 'telegram_text_received', 'telegram-text:' || p_update_id::text,
      'A private Telegram text message was received. Review it in your workspace and choose an application explicitly before taking any action.', '/app/settings', 'needs_review'
    from public.tracked_activities as activity where activity.owner_id = v_owner_id order by activity.created_at asc limit 1;
  update public.telegram_inbound_updates set handled_at = now(), outcome_code = 'PRIVATE_TEXT_RECORDED' where telegram_update_id = p_update_id;
  return 'recorded';
end;
$$;
revoke all on function public.ingest_telegram_private_text_update(bigint, bigint, text, text, text) from public, anon, authenticated;

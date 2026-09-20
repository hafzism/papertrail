-- Telegram is an optional transport over PaperTrail's owner state. A chat never
-- becomes linked merely because it knows a username or sends a /start message:
-- the logged-in owner must confirm the pending private-chat link.
create table public.telegram_link_intents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[A-Fa-f0-9]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'awaiting_owner_confirmation', 'linked', 'expired', 'revoked')),
  telegram_chat_id bigint,
  telegram_username text,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, id)
);
create index telegram_link_intents_owner_created_idx on public.telegram_link_intents (owner_id, created_at desc);

create table public.telegram_channel_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(user_id) on delete cascade,
  telegram_chat_id bigint not null unique,
  telegram_username text,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.telegram_inbound_updates (
  id uuid primary key default gen_random_uuid(),
  telegram_update_id bigint not null unique,
  chat_id bigint,
  update_kind text not null check (char_length(update_kind) between 1 and 80),
  received_at timestamptz not null default now(),
  handled_at timestamptz,
  outcome_code text not null check (char_length(outcome_code) between 1 and 120)
);

alter table public.telegram_link_intents enable row level security;
alter table public.telegram_channel_links enable row level security;
alter table public.telegram_inbound_updates enable row level security;
create policy telegram_link_intents_owner_read on public.telegram_link_intents for select using (owner_id = auth.uid());
create policy telegram_channel_links_owner_read on public.telegram_channel_links for select using (owner_id = auth.uid());
revoke all on public.telegram_link_intents, public.telegram_channel_links, public.telegram_inbound_updates from public, anon, authenticated;
grant select on public.telegram_link_intents, public.telegram_channel_links to authenticated;

create or replace function public.create_telegram_link_intent()
returns table (intent_id uuid, start_token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_intent_id uuid;
  v_expires_at timestamptz := now() + interval '10 minutes';
begin
  if v_owner_id is null then raise exception 'TELEGRAM_LINK_AUTH_REQUIRED'; end if;
  update public.telegram_link_intents set state = 'expired'
    where owner_id = v_owner_id and state = 'pending' and expires_at <= now();
  update public.telegram_link_intents set state = 'revoked'
    where owner_id = v_owner_id and state in ('pending', 'awaiting_owner_confirmation');
  insert into public.telegram_link_intents (owner_id, token_hash, expires_at)
    values (v_owner_id, encode(digest(v_token, 'sha256'), 'hex'), v_expires_at) returning id into v_intent_id;
  return query select v_intent_id, v_token, v_expires_at;
end;
$$;

-- This function is callable only from the server-side webhook using the service
-- role after the HTTP route has verified Telegram's secret header.
create or replace function public.ingest_telegram_start_update(
  p_update_id bigint,
  p_chat_id bigint,
  p_chat_type text,
  p_username text default null,
  p_start_token text default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_intent_id uuid;
  v_inserted integer := 0;
begin
  insert into public.telegram_inbound_updates (telegram_update_id, chat_id, update_kind, outcome_code)
    values (p_update_id, p_chat_id, 'message', 'received')
    on conflict (telegram_update_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;
  if p_chat_type <> 'private' then
    update public.telegram_inbound_updates set handled_at = now(), outcome_code = 'GROUP_OR_NONPRIVATE_REJECTED' where telegram_update_id = p_update_id;
    return 'group_rejected';
  end if;
  if p_start_token is null or p_start_token !~ '^[A-Fa-f0-9]{32,128}$' then
    update public.telegram_inbound_updates set handled_at = now(), outcome_code = 'NO_VALID_LINK_TOKEN' where telegram_update_id = p_update_id;
    return 'ignored';
  end if;
  select id into v_intent_id from public.telegram_link_intents
    where token_hash = encode(digest(p_start_token, 'sha256'), 'hex') and state = 'pending' and expires_at > now()
    for update;
  if v_intent_id is null then
    update public.telegram_inbound_updates set handled_at = now(), outcome_code = 'LINK_TOKEN_INVALID_OR_EXPIRED' where telegram_update_id = p_update_id;
    return 'invalid_token';
  end if;
  update public.telegram_link_intents set state = 'awaiting_owner_confirmation', telegram_chat_id = p_chat_id,
    telegram_username = nullif(left(btrim(coalesce(p_username, '')), 80), '') where id = v_intent_id;
  update public.telegram_inbound_updates set handled_at = now(), outcome_code = 'AWAITING_OWNER_CONFIRMATION' where telegram_update_id = p_update_id;
  return 'pending_confirmation';
end;
$$;

create or replace function public.confirm_telegram_link(p_intent_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_intent public.telegram_link_intents%rowtype;
begin
  if v_owner_id is null then raise exception 'TELEGRAM_LINK_AUTH_REQUIRED'; end if;
  select * into v_intent from public.telegram_link_intents where id = p_intent_id and owner_id = v_owner_id for update;
  if not found then raise exception 'TELEGRAM_LINK_INTENT_NOT_FOUND'; end if;
  if v_intent.state <> 'awaiting_owner_confirmation' or v_intent.expires_at <= now() or v_intent.telegram_chat_id is null then
    raise exception 'TELEGRAM_LINK_INTENT_NOT_CONFIRMABLE';
  end if;
  insert into public.telegram_channel_links (owner_id, telegram_chat_id, telegram_username, linked_at, unlinked_at)
    values (v_owner_id, v_intent.telegram_chat_id, v_intent.telegram_username, now(), null)
    on conflict (owner_id) do update set telegram_chat_id = excluded.telegram_chat_id, telegram_username = excluded.telegram_username, linked_at = now(), unlinked_at = null;
  update public.telegram_link_intents set state = 'linked', confirmed_at = now() where id = v_intent.id;
  return true;
end;
$$;

create or replace function public.unlink_telegram_channel()
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then raise exception 'TELEGRAM_LINK_AUTH_REQUIRED'; end if;
  update public.telegram_channel_links set unlinked_at = now() where owner_id = v_owner_id and unlinked_at is null;
  return found;
end;
$$;

revoke all on function public.create_telegram_link_intent() from public, anon;
grant execute on function public.create_telegram_link_intent() to authenticated;
revoke all on function public.ingest_telegram_start_update(bigint, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.confirm_telegram_link(uuid) from public, anon;
grant execute on function public.confirm_telegram_link(uuid) to authenticated;
revoke all on function public.unlink_telegram_channel() from public, anon;
grant execute on function public.unlink_telegram_channel() to authenticated;

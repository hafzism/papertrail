-- Live voice is an owner-bound, time-limited interaction. This table records
-- only session state/metadata, not a covert microphone stream or transcript.
create table public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  model_name text not null,
  state text not null check (state in ('connecting', 'connected', 'closed', 'failed', 'expired')),
  error_code text,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0 check (row_version >= 0),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);
create index voice_sessions_owner_application_created_idx on public.voice_sessions (owner_id, application_id, created_at desc);
create trigger voice_sessions_touch before update on public.voice_sessions for each row execute procedure public.touch_mutable_row();
alter table public.voice_sessions enable row level security;
create policy voice_sessions_owner_read on public.voice_sessions for select using (owner_id = auth.uid());
revoke all on public.voice_sessions from public, anon, authenticated;
grant select on public.voice_sessions to authenticated;

create or replace function public.create_voice_session(p_application_id uuid, p_model_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner_id uuid := auth.uid(); v_id uuid;
begin
  if v_owner_id is null then raise exception 'VOICE_AUTH_REQUIRED'; end if;
  if char_length(btrim(coalesce(p_model_name, ''))) not between 1 and 120 then raise exception 'VOICE_MODEL_INVALID'; end if;
  if not exists (select 1 from public.applications where id = p_application_id and owner_id = v_owner_id) then raise exception 'VOICE_APPLICATION_NOT_FOUND'; end if;
  insert into public.voice_sessions (owner_id, application_id, model_name, state, expires_at)
    values (v_owner_id, p_application_id, btrim(p_model_name), 'connecting', now() + interval '3 minutes') returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_voice_session_state(p_session_id uuid, p_state text, p_error_code text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then raise exception 'VOICE_AUTH_REQUIRED'; end if;
  if p_state not in ('connected', 'closed', 'failed', 'expired') then raise exception 'VOICE_STATE_INVALID'; end if;
  update public.voice_sessions set state = p_state, error_code = nullif(left(coalesce(p_error_code, ''), 160), ''),
    ended_at = case when p_state in ('closed', 'failed', 'expired') then now() else null end
    where id = p_session_id and owner_id = v_owner_id and state in ('connecting', 'connected')
      and (p_state <> 'connected' or expires_at > now());
  return found;
end;
$$;

revoke all on function public.create_voice_session(uuid, text) from public, anon;
grant execute on function public.create_voice_session(uuid, text) to authenticated;
revoke all on function public.update_voice_session_state(uuid, text, text) from public, anon;
grant execute on function public.update_voice_session_state(uuid, text, text) to authenticated;

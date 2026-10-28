create table public.voice_provider_calls(
  session_id uuid primary key references public.voice_sessions(id) on delete cascade,
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  provider_call_id text not null check(provider_call_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  key_ciphertext text not null,
  closed_at timestamptz
);
alter table public.voice_provider_calls enable row level security;
revoke all on public.voice_provider_calls from public,anon,authenticated;
grant all on public.voice_provider_calls to service_role;

create or replace function public.register_voice_provider_call(p_owner_id uuid,p_session_id uuid,p_call_id text,p_ciphertext text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.voice_sessions%rowtype;
begin
  select * into v_session from public.voice_sessions where id=p_session_id and owner_id=p_owner_id for update;
  if not found then raise exception 'VOICE_SESSION_NOT_FOUND';end if;
  insert into public.voice_provider_calls(session_id,owner_id,provider_call_id,key_ciphertext)values(p_session_id,p_owner_id,p_call_id,p_ciphertext);
  insert into public.jobs(kind,owner_id,dedupe_key,payload,not_before)values('close_voice_session',p_owner_id,'voice-close:'||p_session_id,jsonb_build_object('sessionId',p_session_id),case when v_session.state in('closed','failed','expired')then now() else v_session.expires_at end);
end;$$;

create or replace function public.close_voice_session_after_state()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.state in('closed','failed','expired')then update public.jobs set not_before=now() where kind='close_voice_session' and owner_id=new.owner_id and payload->>'sessionId'=new.id::text and state='queued';end if;
  return new;
end;$$;
create trigger voice_close_after_state after update of state on public.voice_sessions for each row execute function public.close_voice_session_after_state();

create or replace function public.begin_voice_provider_close(p_job_id uuid,p_fencing_token bigint)
returns table(provider_call_id text,key_ciphertext text,session_id uuid)language sql security definer set search_path=public,pg_temp as $$
  select c.provider_call_id,c.key_ciphertext,c.session_id from public.voice_provider_calls c join public.jobs j on c.owner_id=j.owner_id and c.session_id=(j.payload->>'sessionId')::uuid
    where j.id=p_job_id and j.kind='close_voice_session' and j.state='running' and j.fencing_token=p_fencing_token and j.lease_expires_at>now() and c.closed_at is null;
$$;
create or replace function public.finish_voice_provider_close(p_job_id uuid,p_fencing_token bigint)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session uuid;
begin
  update public.voice_provider_calls c set closed_at=now(),key_ciphertext='erased' from public.jobs j where j.id=p_job_id and j.kind='close_voice_session' and j.state='running' and j.fencing_token=p_fencing_token and j.lease_expires_at>now() and c.owner_id=j.owner_id and c.session_id=(j.payload->>'sessionId')::uuid returning c.session_id into v_session;
  if v_session is null then return false;end if;
  update public.voice_sessions set state=case when expires_at<=now()then 'expired' else 'closed' end,ended_at=coalesce(ended_at,least(expires_at,now())) where id=v_session;
  return true;
end;$$;

create or replace function public.create_voice_session(p_application_id uuid,p_model_name text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid:=auth.uid();v_id uuid;v_reserved numeric;
begin
  if v_owner is null then raise exception 'VOICE_AUTH_REQUIRED';end if;
  perform pg_advisory_xact_lock(hashtext('papertrail-live-voice-admission'));
  if not exists(select 1 from public.applications where id=p_application_id and owner_id=v_owner)then raise exception 'VOICE_APPLICATION_NOT_FOUND';end if;
  if char_length(btrim(coalesce(p_model_name,'')))not between 1 and 120 then raise exception 'VOICE_MODEL_INVALID';end if;
  if exists(select 1 from public.voice_sessions where owner_id=v_owner and state in('connecting','connected')and expires_at>now())then raise exception 'VOICE_SESSION_ALREADY_ACTIVE';end if;
  select coalesce(sum(greatest(0,extract(epoch from(coalesce(ended_at,expires_at)-started_at)))),0)into v_reserved from public.voice_sessions;
  if v_reserved+180>1200 then raise exception 'VOICE_CAMPAIGN_TIME_LIMIT';end if;
  insert into public.voice_sessions(owner_id,application_id,model_name,state,expires_at)values(v_owner,p_application_id,btrim(p_model_name),'connecting',now()+interval '3 minutes')returning id into v_id;
  return v_id;
end;$$;
revoke all on function public.register_voice_provider_call(uuid,uuid,text,text),public.begin_voice_provider_close(uuid,bigint),public.finish_voice_provider_close(uuid,bigint),public.close_voice_session_after_state() from public,anon,authenticated;
grant execute on function public.register_voice_provider_call(uuid,uuid,text,text),public.begin_voice_provider_close(uuid,bigint),public.finish_voice_provider_close(uuid,bigint) to service_role,postgres;

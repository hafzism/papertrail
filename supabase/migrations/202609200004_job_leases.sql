-- Durable worker lease/fence primitives. Only trusted workers receive execute access.

create or replace function public.claim_next_job(p_lease_seconds integer default 90)
returns table (
  id uuid,
  kind text,
  owner_id uuid,
  public_scope text,
  payload jsonb,
  fencing_token bigint,
  lease_expires_at timestamptz
) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_lease_seconds < 20 or p_lease_seconds > 300 then raise exception 'JOB_INVALID_LEASE'; end if;
  return query
  with candidate as (
    select jobs.id
    from public.jobs
    where (jobs.state = 'queued' and jobs.not_before <= now())
       or (jobs.state = 'running' and jobs.lease_expires_at <= now())
    order by jobs.not_before, jobs.created_at
    for update skip locked
    limit 1
  ), claimed as (
    update public.jobs as j
    set state = 'running',
        attempts = j.attempts + 1,
        fencing_token = j.fencing_token + 1,
        heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        last_error_code = case
          when j.state = 'running' then 'JOB_LEASE_EXPIRED'
          else j.last_error_code
        end
    where j.id in (select candidate.id from candidate)
    returning j.*
  )
  select claimed.id, claimed.kind, claimed.owner_id, claimed.public_scope, claimed.payload,
    claimed.fencing_token, claimed.lease_expires_at
  from claimed;
end;
$$;

create or replace function public.heartbeat_job(
  p_job_id uuid,
  p_fencing_token bigint,
  p_lease_seconds integer default 90
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_lease_seconds < 20 or p_lease_seconds > 300 then raise exception 'JOB_INVALID_LEASE'; end if;
  update public.jobs
  set heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_job_id
    and state = 'running'
    and fencing_token = p_fencing_token
    and lease_expires_at > now();
  return found;
end;
$$;

create or replace function public.finish_job(
  p_job_id uuid,
  p_fencing_token bigint,
  p_state public.job_state,
  p_error_code text default null
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_state not in ('succeeded', 'failed', 'awaiting_user', 'awaiting_approval', 'budget_paused', 'cancelled', 'outcome_unknown') then
    raise exception 'JOB_INVALID_TERMINAL_STATE';
  end if;
  update public.jobs
  set state = p_state, lease_expires_at = null, heartbeat_at = now(), last_error_code = p_error_code
  where id = p_job_id and state = 'running' and fencing_token = p_fencing_token;
  return found;
end;
$$;

revoke all on function public.claim_next_job(integer) from public, anon, authenticated;
revoke all on function public.heartbeat_job(uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.finish_job(uuid, bigint, public.job_state, text) from public, anon, authenticated;

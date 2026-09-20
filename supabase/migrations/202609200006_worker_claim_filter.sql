-- A partially implemented worker must not consume jobs it cannot safely execute.

create or replace function public.claim_next_supported_job(
  p_lease_seconds integer,
  p_supported_kinds text[]
)
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
  if coalesce(array_length(p_supported_kinds, 1), 0) = 0 then return; end if;

  return query
  with candidate as (
    select jobs.id
    from public.jobs
    where jobs.kind = any(p_supported_kinds)
      and (
        (jobs.state = 'queued' and jobs.not_before <= now())
        or (jobs.state = 'running' and jobs.lease_expires_at <= now())
      )
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

revoke all on function public.claim_next_supported_job(integer, text[]) from public, anon, authenticated;

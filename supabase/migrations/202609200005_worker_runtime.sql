-- Trusted-worker liveness is operational state, not a client-controlled status badge.

create table public.worker_heartbeats (
  worker_id text primary key check (char_length(worker_id) between 1 and 120),
  capabilities jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_job_id uuid references public.jobs(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.worker_heartbeats enable row level security;

create or replace function public.record_worker_heartbeat(
  p_worker_id text,
  p_capabilities jsonb,
  p_current_job_id uuid default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if char_length(p_worker_id) < 1 or char_length(p_worker_id) > 120 then
    raise exception 'WORKER_INVALID_ID';
  end if;
  if jsonb_typeof(p_capabilities) <> 'array' then
    raise exception 'WORKER_INVALID_CAPABILITIES';
  end if;

  insert into public.worker_heartbeats (worker_id, capabilities, current_job_id)
  values (p_worker_id, p_capabilities, p_current_job_id)
  on conflict (worker_id) do update
  set capabilities = excluded.capabilities,
      current_job_id = excluded.current_job_id,
      last_seen_at = now(),
      updated_at = now();
end;
$$;

revoke all on public.worker_heartbeats from public, anon, authenticated;
revoke all on function public.record_worker_heartbeat(text, jsonb, uuid) from public, anon, authenticated;

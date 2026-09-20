-- Public-source checks are moderator-triggered and bounded. A changed byte hash is
-- only a review candidate; it never mutates a published rule or private application.
alter table public.published_program_sources
  add column monitoring_enabled boolean not null default false,
  add column check_requested_at timestamptz,
  add column last_checked_at timestamptz,
  add column last_success_at timestamptz,
  add column last_error_code text,
  add column content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  add column final_url text;

create table public.published_source_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.published_program_sources(id) on delete cascade,
  observed_by uuid references public.profiles(user_id) on delete set null,
  state text not null check (state in ('unchanged', 'changed_candidate', 'failed')),
  final_url text,
  content_type text,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  error_code text,
  created_at timestamptz not null default now()
);
create index published_source_observations_source_created_idx on public.published_source_observations (source_id, created_at desc);
alter table public.published_source_observations enable row level security;
create policy published_source_observations_moderator_read on public.published_source_observations for select using (public.is_notice_moderator());
revoke all on public.published_source_observations from public, anon, authenticated;
grant select on public.published_source_observations to authenticated;

create or replace function public.request_published_source_check(p_source_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_moderator_id uuid := auth.uid(); v_job_id uuid;
begin
  if v_moderator_id is null or not public.is_notice_moderator() then raise exception 'PUBLISHED_SOURCE_MODERATOR_REQUIRED'; end if;
  update public.published_program_sources set monitoring_enabled = true, check_requested_at = now()
    where id = p_source_id and (check_requested_at is null or check_requested_at < now() - interval '1 minute');
  if not found then raise exception 'PUBLISHED_SOURCE_CHECK_COOLDOWN_OR_NOT_FOUND'; end if;
  insert into public.jobs (kind, public_scope, dedupe_key, payload)
    values ('monitor_published_source', 'published-source:' || p_source_id::text, 'published-source-check:' || p_source_id::text || ':' || floor(extract(epoch from now()) / 60)::text, jsonb_build_object('sourceId', p_source_id, 'requestedBy', v_moderator_id)) returning id into v_job_id;
  insert into public.outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
    values ('published_source_check_queued', 'published_program_source', p_source_id, jsonb_build_object('sourceId', p_source_id, 'jobId', v_job_id), 'published-source-check:' || v_job_id::text);
  return v_job_id;
end;
$$;

create or replace function public.begin_published_source_check(p_job_id uuid, p_fencing_token bigint, p_source_id uuid)
returns table (source_url text) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
    select source.source_url from public.published_program_sources as source join public.jobs as job on job.id = p_job_id
    where source.id = p_source_id and job.kind = 'monitor_published_source' and job.public_scope = 'published-source:' || p_source_id::text
      and job.state = 'running' and job.fencing_token = p_fencing_token and job.lease_expires_at > now() and job.payload->>'sourceId' = p_source_id::text
    for update of source;
end;
$$;

create or replace function public.record_published_source_check(
  p_job_id uuid, p_fencing_token bigint, p_source_id uuid, p_state text, p_final_url text default null, p_content_type text default null, p_content_sha256 text default null, p_error_code text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_requested_by uuid; v_previous_sha text; v_observation_state text;
begin
  if p_state not in ('success', 'failed') then raise exception 'PUBLISHED_SOURCE_CHECK_STATE_INVALID'; end if;
  select nullif(job.payload->>'requestedBy', '')::uuid into v_requested_by from public.jobs as job
    where job.id = p_job_id and job.kind = 'monitor_published_source' and job.public_scope = 'published-source:' || p_source_id::text
      and job.state = 'running' and job.fencing_token = p_fencing_token and job.lease_expires_at > now();
  if not found then return false; end if;
  select content_sha256 into v_previous_sha from public.published_program_sources where id = p_source_id for update;
  if not found then return false; end if;
  if p_state = 'success' then
    if p_content_sha256 !~ '^[A-Fa-f0-9]{64}$' then raise exception 'PUBLISHED_SOURCE_CHECK_HASH_INVALID'; end if;
    v_observation_state := case when v_previous_sha is null or v_previous_sha = lower(p_content_sha256) then 'unchanged' else 'changed_candidate' end;
    update public.published_program_sources set last_checked_at = now(), last_success_at = now(), last_error_code = null, final_url = p_final_url, content_sha256 = lower(p_content_sha256) where id = p_source_id;
    insert into public.published_source_observations (source_id, observed_by, state, final_url, content_type, content_sha256) values (p_source_id, v_requested_by, v_observation_state, p_final_url, p_content_type, lower(p_content_sha256));
  else
    update public.published_program_sources set last_checked_at = now(), last_error_code = left(coalesce(p_error_code, 'PUBLISHED_SOURCE_CHECK_FAILED'), 160) where id = p_source_id;
    insert into public.published_source_observations (source_id, observed_by, state, error_code) values (p_source_id, v_requested_by, 'failed', left(coalesce(p_error_code, 'PUBLISHED_SOURCE_CHECK_FAILED'), 160));
  end if;
  return true;
end;
$$;
revoke all on function public.request_published_source_check(uuid) from public, anon;
grant execute on function public.request_published_source_check(uuid) to authenticated;
revoke all on function public.begin_published_source_check(uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.record_published_source_check(uuid, bigint, uuid, text, text, text, text, text) from public, anon, authenticated;

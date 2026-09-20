-- A byte-level source change becomes a public revision only after a moderator
-- explicitly approves it. The resulting owner notice requests review; it never
-- decides eligibility or rewrites private requirements.
alter table public.published_source_observations
  drop constraint if exists published_source_observations_state_check;
alter table public.published_source_observations
  add constraint published_source_observations_state_check
  check (state in ('unchanged', 'changed_candidate', 'published_revision', 'failed'));

alter table public.published_source_observations
  add column reviewed_by uuid references public.profiles(user_id) on delete set null,
  add column reviewed_at timestamptz,
  add column moderator_note text check (moderator_note is null or char_length(moderator_note) <= 1000);

create table public.published_notice_revisions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  source_id uuid not null references public.published_program_sources(id) on delete cascade,
  observation_id uuid not null unique references public.published_source_observations(id) on delete restrict,
  source_url text not null,
  content_sha256 text not null check (content_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  moderator_id uuid not null references public.profiles(user_id) on delete restrict,
  moderator_note text check (moderator_note is null or char_length(moderator_note) <= 1000),
  created_at timestamptz not null default now()
);
create index published_notice_revisions_program_created_idx on public.published_notice_revisions (program_id, created_at desc);
alter table public.published_notice_revisions enable row level security;
create policy published_notice_revisions_read on public.published_notice_revisions for select using (true);
revoke all on public.published_notice_revisions from public, anon, authenticated;
grant select on public.published_notice_revisions to authenticated;

create or replace function public.approve_published_source_revision(
  p_observation_id uuid,
  p_moderator_note text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_moderator_id uuid := auth.uid();
  v_observation public.published_source_observations%rowtype;
  v_source public.published_program_sources%rowtype;
  v_revision_id uuid;
  v_application record;
begin
  if v_moderator_id is null or not public.is_notice_moderator() then raise exception 'PUBLISHED_SOURCE_MODERATOR_REQUIRED'; end if;
  if char_length(coalesce(p_moderator_note, '')) > 1000 then raise exception 'PUBLISHED_SOURCE_MODERATION_NOTE_INVALID'; end if;
  select * into v_observation from public.published_source_observations where id = p_observation_id for update;
  if not found then raise exception 'PUBLISHED_SOURCE_OBSERVATION_NOT_FOUND'; end if;
  if v_observation.state <> 'changed_candidate' then raise exception 'PUBLISHED_SOURCE_OBSERVATION_NOT_ACTIONABLE'; end if;
  if v_observation.content_sha256 is null then raise exception 'PUBLISHED_SOURCE_OBSERVATION_HASH_MISSING'; end if;
  select * into v_source from public.published_program_sources where id = v_observation.source_id for update;
  if not found then raise exception 'PUBLISHED_SOURCE_NOT_FOUND'; end if;

  insert into public.published_notice_revisions (program_id, source_id, observation_id, source_url, content_sha256, moderator_id, moderator_note)
    values (v_source.program_id, v_source.id, v_observation.id, coalesce(v_observation.final_url, v_source.source_url), v_observation.content_sha256, v_moderator_id, nullif(btrim(p_moderator_note), ''))
    returning id into v_revision_id;
  update public.published_source_observations set state = 'published_revision', reviewed_by = v_moderator_id, reviewed_at = now(), moderator_note = nullif(btrim(p_moderator_note), '') where id = v_observation.id;
  update public.program_cycles set policy_epoch = policy_epoch + 1 where program_id = v_source.program_id;

  for v_application in select application.id, application.owner_id from public.applications as application join public.program_cycles as cycle on cycle.id = application.program_cycle_id where cycle.program_id = v_source.program_id and application.monitoring_enabled loop
    insert into public.notifications (owner_id, application_id, event_type, dedupe_key, minimal_text, deep_link, actionable_status)
      values (v_application.owner_id, v_application.id, 'published_source_revision', 'published-source-revision:' || v_revision_id::text || ':application:' || v_application.id::text, 'A moderator recorded a revised public source for this linked program. Review it before relying on prior planning; private requirements were not re-evaluated automatically.', '/app/applications/' || v_application.id::text, 'needs_review')
      on conflict (owner_id, dedupe_key) do nothing;
  end loop;

  insert into public.outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
    values ('published_source_revision_approved', 'published_notice_revision', v_revision_id, jsonb_build_object('revisionId', v_revision_id, 'sourceId', v_source.id, 'programId', v_source.program_id), 'published-source-revision:' || v_revision_id::text);
  return v_revision_id;
end;
$$;
revoke all on function public.approve_published_source_revision(uuid, text) from public, anon;
grant execute on function public.approve_published_source_revision(uuid, text) to authenticated;

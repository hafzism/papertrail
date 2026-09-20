-- Requirement extraction is a bounded private proposal workflow. A model may suggest
-- atomic cited items, but only the owner can accept one into the unresolved private
-- requirement ledger. The worker never receives authority to create requirements.

create table public.private_requirement_proposal_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  private_snapshot_id uuid not null references public.private_notice_snapshots(id) on delete cascade,
  source_content_sha256 text not null check (source_content_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  job_id uuid unique references public.jobs(id) on delete set null,
  state text not null default 'queued' check (state in ('queued', 'running', 'completed', 'failed')),
  prompt_version text not null check (char_length(prompt_version) between 1 and 120),
  model_name text check (char_length(model_name) between 1 and 120),
  provider_request_id text check (char_length(provider_request_id) between 1 and 255),
  error_code text check (char_length(error_code) between 1 and 160),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);

create unique index private_requirement_proposal_runs_one_active_source_idx
  on public.private_requirement_proposal_runs (owner_id, application_id, private_snapshot_id)
  where state in ('queued', 'running');
create index private_requirement_proposal_runs_owner_application_idx
  on public.private_requirement_proposal_runs (owner_id, application_id, created_at desc);

create table public.private_requirement_proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.private_requirement_proposal_runs(id) on delete cascade,
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  private_snapshot_id uuid not null references public.private_notice_snapshots(id) on delete cascade,
  ordinal integer not null check (ordinal between 1 and 20),
  logical_key text not null check (logical_key ~ '^[a-z][a-z0-9_.-]{0,119}$'),
  kind text not null check (kind in ('document', 'field', 'eligibility', 'deadline', 'format', 'fee', 'declaration')),
  label text not null check (char_length(label) between 1 and 500),
  citation_excerpt text not null check (char_length(citation_excerpt) between 1 and 4000),
  citation_source_hash text not null check (citation_source_hash ~ '^[A-Fa-f0-9]{64}$'),
  citation_basis text not null check (citation_basis = 'owner_text'),
  predicate_json jsonb not null default '{"op":"manual_review","reason":"Requirement has not been reviewed."}'::jsonb,
  applicability_json jsonb not null default '{"op":"manual_review","reason":"Applicability has not been reviewed."}'::jsonb,
  effective_from date,
  ambiguity_flags jsonb not null default '[]'::jsonb,
  review_state text not null default 'proposed' check (review_state in ('proposed', 'accepted', 'rejected')),
  accepted_requirement_id uuid references public.private_requirement_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade,
  unique (run_id, ordinal),
  check (public.is_valid_requirement_predicate(predicate_json)),
  check (public.is_valid_requirement_predicate(applicability_json)),
  check (public.is_valid_requirement_ambiguity_flags(ambiguity_flags)),
  check (
    (review_state = 'proposed' and reviewed_at is null and accepted_requirement_id is null)
    or (review_state = 'accepted' and reviewed_at is not null and accepted_requirement_id is not null)
    or (review_state = 'rejected' and reviewed_at is not null and accepted_requirement_id is null)
  )
);

create index private_requirement_proposals_owner_application_idx
  on public.private_requirement_proposals (owner_id, application_id, created_at desc);
create index private_requirement_proposals_run_review_idx
  on public.private_requirement_proposals (run_id, review_state, ordinal);

alter table public.private_requirement_proposal_runs enable row level security;
alter table public.private_requirement_proposals enable row level security;
create policy private_requirement_proposal_runs_owner_read on public.private_requirement_proposal_runs
  for select using (owner_id = auth.uid());
create policy private_requirement_proposals_owner_read on public.private_requirement_proposals
  for select using (owner_id = auth.uid());
revoke all on public.private_requirement_proposal_runs from public, anon, authenticated;
revoke all on public.private_requirement_proposals from public, anon, authenticated;
grant select on public.private_requirement_proposal_runs, public.private_requirement_proposals to authenticated;

create or replace function public.request_private_requirement_proposal(
  p_application_id uuid,
  p_private_snapshot_id uuid
)
returns table (proposal_run_id uuid, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_source_hash text;
  v_deletion_generation integer;
  v_sequence bigint;
  v_proposal_run_id uuid;
  v_job_id uuid;
begin
  if v_owner_id is null then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_UNAUTHENTICATED'; end if;

  -- This lock proves draft ownership and serializes the application event sequence.
  perform 1 from public.applications
    where id = p_application_id and owner_id = v_owner_id and lifecycle_state = 'draft'
    for update;
  if not found then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_APPLICATION_NOT_DRAFT_OR_NOT_FOUND'; end if;

  select content_sha256 into v_source_hash
  from public.private_notice_snapshots
  where id = p_private_snapshot_id
    and owner_id = v_owner_id
    and application_id = p_application_id
    and source_kind = 'text_description'
    and source_status = 'unresolved'
    and captured_text is not null;
  if v_source_hash is null then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_TEXT_SOURCE_NOT_FOUND'; end if;

  if exists (
    select 1 from public.private_requirement_proposal_runs
    where owner_id = v_owner_id and application_id = p_application_id and private_snapshot_id = p_private_snapshot_id
      and state in ('queued', 'running')
  ) then
    raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_ALREADY_QUEUED';
  end if;

  select deletion_generation into v_deletion_generation
  from public.profiles where user_id = v_owner_id for share;
  if v_deletion_generation is null then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_PROFILE_MISSING'; end if;

  insert into public.private_requirement_proposal_runs (
    owner_id, application_id, private_snapshot_id, source_content_sha256, prompt_version
  ) values (
    v_owner_id, p_application_id, p_private_snapshot_id, v_source_hash, 'requirement-proposal-v1'
  ) returning id into v_proposal_run_id;

  insert into public.jobs (kind, owner_id, dedupe_key, payload)
  values (
    'propose_private_requirements', v_owner_id, 'private-requirement-proposal:' || v_proposal_run_id::text,
    jsonb_build_object('proposalRunId', v_proposal_run_id, 'privateSnapshotId', p_private_snapshot_id, 'deletionGeneration', v_deletion_generation)
  ) returning id into v_job_id;

  update public.private_requirement_proposal_runs set job_id = v_job_id
  where id = v_proposal_run_id;

  insert into public.outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
  values (
    'private_requirement_proposal_queued', 'private_requirement_proposal_run', v_proposal_run_id,
    jsonb_build_object('ownerId', v_owner_id, 'applicationId', p_application_id, 'privateSnapshotId', p_private_snapshot_id, 'proposalRunId', v_proposal_run_id, 'jobId', v_job_id),
    'private-requirement-proposal:' || v_proposal_run_id::text
  );

  select coalesce(max(sequence), 0) + 1 into v_sequence
  from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (
    v_owner_id, p_application_id, v_sequence, 'owner', 'private_requirement_proposal_requested',
    'Private requirement suggestions queued for review',
    jsonb_build_object('privateSnapshotId', p_private_snapshot_id, 'proposalRunId', v_proposal_run_id, 'jobId', v_job_id)
  );
  proposal_run_id := v_proposal_run_id;
  job_id := v_job_id;
  return next;
end;
$$;

create or replace function public.begin_private_requirement_proposal(
  p_job_id uuid,
  p_fencing_token bigint,
  p_owner_id uuid,
  p_proposal_run_id uuid,
  p_deletion_generation integer
)
returns table (source_text text, source_content_sha256 text, prompt_version text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_source_text text;
  v_source_hash text;
  v_prompt_version text;
begin
  select snapshot.captured_text, snapshot.content_sha256, run.prompt_version
  into v_source_text, v_source_hash, v_prompt_version
  from public.private_requirement_proposal_runs as run
  join public.private_notice_snapshots as snapshot on snapshot.id = run.private_snapshot_id
  join public.jobs as job on job.id = p_job_id
  join public.profiles as profile on profile.user_id = job.owner_id
  where run.id = p_proposal_run_id
    and run.owner_id = p_owner_id
    and run.state in ('queued', 'running')
    and snapshot.owner_id = p_owner_id
    and snapshot.application_id = run.application_id
    and snapshot.source_kind = 'text_description'
    and snapshot.source_status = 'unresolved'
    and snapshot.content_sha256 = run.source_content_sha256
    and job.owner_id = p_owner_id
    and job.kind = 'propose_private_requirements'
    and job.state = 'running'
    and job.fencing_token = p_fencing_token
    and job.lease_expires_at > now()
    and job.payload->>'proposalRunId' = p_proposal_run_id::text
    and job.payload->>'privateSnapshotId' = run.private_snapshot_id::text
    and (job.payload->>'deletionGeneration')::integer = p_deletion_generation
    and profile.deletion_generation = p_deletion_generation
  for update of run;
  if v_source_text is null then return; end if;

  update public.private_requirement_proposal_runs
  set state = 'running', started_at = coalesce(started_at, now()), updated_at = now()
  where id = p_proposal_run_id and state in ('queued', 'running');

  return query select v_source_text, v_source_hash, v_prompt_version;
end;
$$;

create or replace function public.record_private_requirement_proposal(
  p_job_id uuid,
  p_fencing_token bigint,
  p_owner_id uuid,
  p_proposal_run_id uuid,
  p_deletion_generation integer,
  p_state text,
  p_model_name text default null,
  p_provider_request_id text default null,
  p_candidates jsonb default '[]'::jsonb,
  p_error_code text default null
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_application_id uuid;
  v_snapshot_id uuid;
  v_source_text text;
  v_source_hash text;
  v_sequence bigint;
  v_candidate jsonb;
  v_ordinal integer := 0;
  v_logical_key text;
  v_kind text;
  v_label text;
  v_citation_excerpt text;
  v_ambiguity_flags jsonb;
begin
  if p_state not in ('completed', 'failed') then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_INVALID_STATE'; end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 20 then
    raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_INVALID_CANDIDATES';
  end if;
  if p_state = 'completed' and (p_error_code is not null or char_length(coalesce(p_model_name, '')) not between 1 and 120) then
    raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_COMPLETED_METADATA_INVALID';
  end if;
  if p_state = 'failed' and (char_length(coalesce(p_error_code, '')) not between 1 and 160 or jsonb_array_length(p_candidates) <> 0) then
    raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_FAILED_METADATA_INVALID';
  end if;
  if p_provider_request_id is not null and char_length(p_provider_request_id) not between 1 and 255 then
    raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_INVALID_PROVIDER_REQUEST';
  end if;

  select run.application_id, run.private_snapshot_id, snapshot.captured_text, snapshot.content_sha256
  into v_application_id, v_snapshot_id, v_source_text, v_source_hash
  from public.private_requirement_proposal_runs as run
  join public.private_notice_snapshots as snapshot on snapshot.id = run.private_snapshot_id
  join public.jobs as job on job.id = p_job_id
  join public.profiles as profile on profile.user_id = job.owner_id
  where run.id = p_proposal_run_id
    and run.owner_id = p_owner_id
    and run.state = 'running'
    and snapshot.owner_id = p_owner_id
    and snapshot.application_id = run.application_id
    and snapshot.source_kind = 'text_description'
    and snapshot.source_status = 'unresolved'
    and snapshot.content_sha256 = run.source_content_sha256
    and job.owner_id = p_owner_id
    and job.kind = 'propose_private_requirements'
    and job.state = 'running'
    and job.fencing_token = p_fencing_token
    and job.lease_expires_at > now()
    and job.payload->>'proposalRunId' = p_proposal_run_id::text
    and job.payload->>'privateSnapshotId' = run.private_snapshot_id::text
    and (job.payload->>'deletionGeneration')::integer = p_deletion_generation
    and profile.deletion_generation = p_deletion_generation
  for update of run;
  if v_application_id is null then return false; end if;

  if p_state = 'completed' then
    for v_candidate in select value from jsonb_array_elements(p_candidates) loop
      v_ordinal := v_ordinal + 1;
      if jsonb_typeof(v_candidate) <> 'object'
        or (v_candidate - array['logicalKey', 'kind', 'label', 'citationExcerpt', 'ambiguityFlags']) <> '{}'::jsonb
        or jsonb_typeof(v_candidate->'logicalKey') <> 'string'
        or jsonb_typeof(v_candidate->'kind') <> 'string'
        or jsonb_typeof(v_candidate->'label') <> 'string'
        or jsonb_typeof(v_candidate->'citationExcerpt') <> 'string'
      then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_INVALID_CANDIDATE'; end if;

      v_logical_key := v_candidate->>'logicalKey';
      v_kind := v_candidate->>'kind';
      v_label := trim(v_candidate->>'label');
      v_citation_excerpt := v_candidate->>'citationExcerpt';
      v_ambiguity_flags := v_candidate->'ambiguityFlags';
      if v_logical_key !~ '^[a-z][a-z0-9_.-]{0,119}$' then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_INVALID_KEY'; end if;
      if v_kind not in ('document', 'field', 'eligibility', 'deadline', 'format', 'fee', 'declaration') then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_INVALID_KIND'; end if;
      if char_length(v_label) not between 1 and 500 then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_INVALID_LABEL'; end if;
      -- Citation text is stored byte-for-byte and must still occur in the immutable source.
      if char_length(v_citation_excerpt) not between 1 and 4000 or position(v_citation_excerpt in v_source_text) = 0 then
        raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_CITATION_NOT_IN_SOURCE';
      end if;
      if not public.is_valid_requirement_ambiguity_flags(v_ambiguity_flags) then
        raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_INVALID_AMBIGUITY_FLAGS';
      end if;

      insert into public.private_requirement_proposals (
        run_id, owner_id, application_id, private_snapshot_id, ordinal, logical_key, kind, label,
        citation_excerpt, citation_source_hash, citation_basis, ambiguity_flags
      ) values (
        p_proposal_run_id, p_owner_id, v_application_id, v_snapshot_id, v_ordinal, v_logical_key, v_kind, v_label,
        v_citation_excerpt, v_source_hash, 'owner_text', v_ambiguity_flags
      );
    end loop;
  end if;

  update public.private_requirement_proposal_runs
  set state = p_state,
      model_name = p_model_name,
      provider_request_id = p_provider_request_id,
      error_code = p_error_code,
      completed_at = now(),
      updated_at = now()
  where id = p_proposal_run_id and state = 'running';
  if not found then return false; end if;

  perform 1 from public.applications
  where id = v_application_id and owner_id = p_owner_id
  for update;
  select coalesce(max(sequence), 0) + 1 into v_sequence
  from public.application_events where application_id = v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (
    p_owner_id, v_application_id, v_sequence, 'worker',
    case when p_state = 'completed' then 'private_requirement_proposal_completed' else 'private_requirement_proposal_failed' end,
    case when p_state = 'completed' then 'Private requirement suggestions are ready for review' else 'Private requirement suggestion run needs attention' end,
    jsonb_build_object('proposalRunId', p_proposal_run_id, 'privateSnapshotId', v_snapshot_id)
  );
  return true;
end;
$$;

create or replace function public.accept_private_requirement_proposal(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_application_id uuid;
  v_snapshot_id uuid;
  v_logical_key text;
  v_kind text;
  v_label text;
  v_citation_excerpt text;
  v_citation_source_hash text;
  v_ambiguity_flags jsonb;
  v_requirement_id uuid;
  v_sequence bigint;
begin
  if v_owner_id is null then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_UNAUTHENTICATED'; end if;

  select proposal.application_id, proposal.private_snapshot_id, proposal.logical_key, proposal.kind,
    proposal.label, proposal.citation_excerpt, proposal.citation_source_hash, proposal.ambiguity_flags
  into v_application_id, v_snapshot_id, v_logical_key, v_kind, v_label, v_citation_excerpt,
    v_citation_source_hash, v_ambiguity_flags
  from public.private_requirement_proposals as proposal
  join public.private_requirement_proposal_runs as run on run.id = proposal.run_id
  join public.private_notice_snapshots as snapshot on snapshot.id = proposal.private_snapshot_id
  where proposal.id = p_proposal_id
    and proposal.owner_id = v_owner_id
    and proposal.review_state = 'proposed'
    and run.owner_id = v_owner_id
    and run.state = 'completed'
    and snapshot.owner_id = v_owner_id
    and snapshot.application_id = proposal.application_id
    and snapshot.source_kind = 'text_description'
    and snapshot.source_status = 'unresolved'
    and snapshot.content_sha256 = proposal.citation_source_hash
    and position(proposal.citation_excerpt in snapshot.captured_text) > 0
  for update of proposal;
  if v_application_id is null then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_NOT_AVAILABLE'; end if;

  perform 1 from public.applications
  where id = v_application_id and owner_id = v_owner_id and lifecycle_state = 'draft'
  for update;
  if not found then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_APPLICATION_NOT_DRAFT_OR_NOT_FOUND'; end if;

  -- Accepting a model proposal preserves its exact citation, but leaves the rule and
  -- applicability at explicit manual-review defaults. It is never an eligibility result.
  insert into public.private_requirement_versions (
    owner_id, application_id, private_snapshot_id, logical_key, kind, label, citation_excerpt,
    citation_source_hash, citation_basis, review_state, ambiguity_flags
  ) values (
    v_owner_id, v_application_id, v_snapshot_id, v_logical_key, v_kind, v_label, v_citation_excerpt,
    v_citation_source_hash, 'owner_text', 'unresolved', v_ambiguity_flags
  ) returning id into v_requirement_id;

  update public.private_requirement_proposals
  set review_state = 'accepted', accepted_requirement_id = v_requirement_id, reviewed_at = now()
  where id = p_proposal_id and review_state = 'proposed';
  if not found then raise exception 'PRIVATE_REQUIREMENT_PROPOSAL_NOT_AVAILABLE'; end if;

  select coalesce(max(sequence), 0) + 1 into v_sequence
  from public.application_events where application_id = v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (
    v_owner_id, v_application_id, v_sequence, 'owner', 'private_requirement_proposal_accepted',
    'Private requirement suggestion accepted as an unresolved review item',
    jsonb_build_object('proposalId', p_proposal_id, 'privateRequirementId', v_requirement_id, 'privateSnapshotId', v_snapshot_id)
  );
  return v_requirement_id;
end;
$$;

revoke all on function public.request_private_requirement_proposal(uuid, uuid) from public, anon;
grant execute on function public.request_private_requirement_proposal(uuid, uuid) to authenticated;
revoke all on function public.begin_private_requirement_proposal(uuid, bigint, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.record_private_requirement_proposal(uuid, bigint, uuid, uuid, integer, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.accept_private_requirement_proposal(uuid) from public, anon;
grant execute on function public.accept_private_requirement_proposal(uuid) to authenticated;

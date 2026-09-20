-- PaperTrail W1 foundation. Apply through the Supabase CLI; do not run pieces manually.
-- All currency is integer nanodollars (1 USD = 1,000,000,000 nanodollars).

create extension if not exists pgcrypto;

create type public.application_lifecycle as enum (
  'draft', 'prepared', 'submission_in_progress', 'submitted_unconfirmed',
  'acknowledged', 'accepted', 'rejected', 'withdrawn', 'archived'
);
create type public.readiness_state as enum ('incomplete', 'needs_review', 'ready', 'stale', 'correction_required');
create type public.job_state as enum (
  'queued', 'running', 'awaiting_user', 'awaiting_approval', 'succeeded', 'failed',
  'budget_paused', 'cancel_requested', 'cancelled', 'outcome_unknown'
);
create type public.reservation_state as enum ('active', 'settled', 'charge_uncertain', 'released');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  language text not null default 'en' check (language in ('en', 'ml')),
  timezone text not null default 'Asia/Kolkata',
  notification_preferences jsonb not null default '{}'::jsonb,
  deletion_generation integer not null default 0 check (deletion_generation >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0 check (row_version >= 0)
);

create table public.platform_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('notice_moderator')),
  assigned_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  official_domains text[] not null default '{}',
  verification_state text not null default 'unverified' check (verification_state in ('unverified', 'pending', 'verified', 'rejected')),
  verification_evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0
);

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  name text not null,
  jurisdiction text,
  category text,
  canonical_slug text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0,
  unique (institution_id, canonical_slug)
);

create table public.program_cycles (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id),
  cycle_label text not null,
  starts_on date,
  ends_on date,
  policy_epoch bigint not null default 0 check (policy_epoch >= 0),
  current_published_set_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0,
  unique (program_id, cycle_label)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  program_cycle_id uuid references public.program_cycles(id),
  title text not null check (char_length(title) between 1 and 200),
  lifecycle_state public.application_lifecycle not null default 'draft',
  readiness_state public.readiness_state not null default 'incomplete',
  monitoring_enabled boolean not null default false,
  material_version bigint not null default 0 check (material_version >= 0),
  last_evaluated_policy_epoch bigint,
  selected_destination jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0,
  unique (owner_id, id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  label text not null check (char_length(label) between 1 and 200),
  document_type text,
  latest_version_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0,
  unique (owner_id, id)
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  document_id uuid not null,
  object_path text not null unique,
  sha256 text not null check (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  page_count integer check (page_count > 0 and page_count <= 50),
  issued_on date,
  expires_on date,
  extraction_state text not null default 'pending' check (extraction_state in ('pending', 'processing', 'completed', 'failed', 'needs_input')),
  predecessor_id uuid references public.document_versions(id),
  created_at timestamptz not null default now(),
  foreign key (owner_id, document_id) references public.documents(owner_id, id) on delete cascade,
  unique (owner_id, id),
  unique (owner_id, document_id, sha256)
);
alter table public.documents
  add constraint documents_latest_version_owner_fk
  foreign key (owner_id, latest_version_id) references public.document_versions(owner_id, id) deferrable initially deferred;

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  sequence bigint not null,
  actor_type text not null check (actor_type in ('owner', 'moderator', 'worker', 'system')),
  event_type text not null,
  redacted_summary text not null,
  related_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade,
  unique (application_id, sequence)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  owner_id uuid references public.profiles(user_id) on delete cascade,
  public_scope text,
  dedupe_key text not null,
  payload jsonb not null,
  state public.job_state not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 3),
  not_before timestamptz not null default now(),
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  heartbeat_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_id is null) <> (public_scope is null)),
  unique (kind, dedupe_key)
);

create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  dedupe_key text not null unique,
  dispatched_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  created_at timestamptz not null default now()
);

create table public.idempotency_keys (
  actor_id uuid not null references public.profiles(user_id) on delete cascade,
  operation text not null,
  key text not null check (char_length(key) between 8 and 255),
  request_sha256 text not null check (request_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  response jsonb,
  operation_id uuid,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation, key)
);

create table public.budget_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  allowed_nano bigint not null check (allowed_nano >= 0),
  default_owner_limit_nano bigint not null check (default_owner_limit_nano >= 0),
  default_run_limit_nano bigint not null check (default_run_limit_nano >= 0),
  state text not null default 'active' check (state in ('active', 'paused', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.budget_category_limits (
  campaign_id uuid not null references public.budget_campaigns(id) on delete cascade,
  category text not null check (category in ('model_inference', 'live_voice', 'transcription', 'integration_smoke', 'repair_contingency')),
  allowed_nano bigint not null check (allowed_nano >= 0),
  primary key (campaign_id, category)
);

create table public.budget_reservations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.budget_campaigns(id),
  category text not null,
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  run_id uuid not null,
  provider text not null,
  reserved_nano bigint not null check (reserved_nano > 0),
  state public.reservation_state not null default 'active',
  provider_request_id text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (provider, run_id, provider_request_id)
);

create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.budget_reservations(id),
  campaign_id uuid not null references public.budget_campaigns(id),
  category text not null,
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  run_id uuid not null,
  provider text not null,
  actual_nano bigint not null check (actual_nano >= 0),
  usage jsonb not null,
  created_at timestamptz not null default now()
);

create index applications_owner_updated_idx on public.applications (owner_id, updated_at desc);
create index document_versions_owner_hash_idx on public.document_versions (owner_id, sha256);
create index jobs_due_idx on public.jobs (state, not_before) where state = 'queued';
create index outbox_pending_idx on public.outbox (created_at) where dispatched_at is null;
create index budget_reservation_active_idx on public.budget_reservations (campaign_id, category, owner_id, run_id) where state in ('active', 'charge_uncertain');
create index application_events_owner_app_idx on public.application_events (owner_id, application_id, sequence);

create or replace function public.touch_mutable_row()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles for each row execute procedure public.touch_mutable_row();
create trigger applications_touch before update on public.applications for each row execute procedure public.touch_mutable_row();
create trigger documents_touch before update on public.documents for each row execute procedure public.touch_mutable_row();
create trigger institutions_touch before update on public.institutions for each row execute procedure public.touch_mutable_row();
create trigger programs_touch before update on public.programs for each row execute procedure public.touch_mutable_row();
create trigger program_cycles_touch before update on public.program_cycles for each row execute procedure public.touch_mutable_row();

create or replace function public.is_notice_moderator()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.platform_roles where user_id = auth.uid() and role = 'notice_moderator');
$$;

alter table public.profiles enable row level security;
alter table public.platform_roles enable row level security;
alter table public.applications enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.application_events enable row level security;
alter table public.jobs enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.budget_reservations enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.institutions enable row level security;
alter table public.programs enable row level security;
alter table public.program_cycles enable row level security;
alter table public.outbox enable row level security;
alter table public.budget_campaigns enable row level security;
alter table public.budget_category_limits enable row level security;

create policy profiles_owner on public.profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy applications_owner on public.applications for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy documents_owner on public.documents for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy document_versions_owner on public.document_versions for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy application_events_owner on public.application_events for select using (owner_id = auth.uid());
create policy idempotency_owner on public.idempotency_keys for all using (actor_id = auth.uid()) with check (actor_id = auth.uid());
create policy budget_reservations_owner on public.budget_reservations for select using (owner_id = auth.uid());
create policy usage_ledger_owner on public.usage_ledger for select using (owner_id = auth.uid());
create policy published_programs_read on public.institutions for select using (true);
create policy published_programs_read on public.programs for select using (true);
create policy published_programs_read on public.program_cycles for select using (true);

-- No policy permits a client to read or mutate roles, jobs, outbox, or budget configuration.
-- Service-role workers bypass RLS but must call scoped server code, never client-supplied owner IDs.
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles, public.applications, public.documents, public.document_versions, public.idempotency_keys to authenticated;
grant select on public.application_events, public.budget_reservations, public.usage_ledger, public.institutions, public.programs, public.program_cycles to authenticated;

create or replace function public.reserve_budget(
  p_campaign_id uuid,
  p_category text,
  p_owner_id uuid,
  p_run_id uuid,
  p_provider text,
  p_amount_nano bigint,
  p_provider_request_id text default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.budget_campaigns%rowtype;
  v_category_limit bigint;
  v_campaign_used bigint;
  v_category_used bigint;
  v_owner_used bigint;
  v_run_used bigint;
  v_reservation_id uuid;
begin
  if p_amount_nano <= 0 then raise exception 'BUDGET_INVALID_AMOUNT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 0));
  select * into v_campaign from public.budget_campaigns where id = p_campaign_id for update;
  if not found or v_campaign.state <> 'active' then raise exception 'BUDGET_PAUSED'; end if;
  select allowed_nano into v_category_limit from public.budget_category_limits
    where campaign_id = p_campaign_id and category = p_category for update;
  if v_category_limit is null then raise exception 'BUDGET_CATEGORY_UNCONFIGURED'; end if;

  -- Recompute inclusive totals separately to avoid a read-before-write admission race.
  select coalesce((select sum(reserved_nano) from public.budget_reservations where campaign_id = p_campaign_id and state in ('active', 'charge_uncertain')), 0)
       + coalesce((select sum(actual_nano) from public.usage_ledger where campaign_id = p_campaign_id), 0) into v_campaign_used;
  select coalesce((select sum(reserved_nano) from public.budget_reservations where campaign_id = p_campaign_id and category = p_category and state in ('active', 'charge_uncertain')), 0)
       + coalesce((select sum(actual_nano) from public.usage_ledger where campaign_id = p_campaign_id and category = p_category), 0) into v_category_used;
  select coalesce((select sum(reserved_nano) from public.budget_reservations where campaign_id = p_campaign_id and owner_id = p_owner_id and state in ('active', 'charge_uncertain')), 0)
       + coalesce((select sum(actual_nano) from public.usage_ledger where campaign_id = p_campaign_id and owner_id = p_owner_id), 0) into v_owner_used;
  select coalesce((select sum(reserved_nano) from public.budget_reservations where campaign_id = p_campaign_id and run_id = p_run_id and state in ('active', 'charge_uncertain')), 0)
       + coalesce((select sum(actual_nano) from public.usage_ledger where campaign_id = p_campaign_id and run_id = p_run_id), 0) into v_run_used;

  if v_campaign_used + p_amount_nano > v_campaign.allowed_nano then raise exception 'BUDGET_CAMPAIGN_EXHAUSTED'; end if;
  if v_category_used + p_amount_nano > v_category_limit then raise exception 'BUDGET_CATEGORY_EXHAUSTED'; end if;
  if v_owner_used + p_amount_nano > v_campaign.default_owner_limit_nano then raise exception 'BUDGET_OWNER_EXHAUSTED'; end if;
  if v_run_used + p_amount_nano > v_campaign.default_run_limit_nano then raise exception 'BUDGET_RUN_EXHAUSTED'; end if;

  insert into public.budget_reservations (campaign_id, category, owner_id, run_id, provider, reserved_nano, provider_request_id)
  values (p_campaign_id, p_category, p_owner_id, p_run_id, p_provider, p_amount_nano, p_provider_request_id)
  returning id into v_reservation_id;
  return v_reservation_id;
end;
$$;

create or replace function public.settle_budget_reservation(
  p_reservation_id uuid,
  p_actual_nano bigint,
  p_usage jsonb
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reservation public.budget_reservations%rowtype;
begin
  if p_actual_nano < 0 then raise exception 'BUDGET_INVALID_AMOUNT'; end if;
  select * into v_reservation from public.budget_reservations where id = p_reservation_id for update;
  if not found then raise exception 'BUDGET_RESERVATION_NOT_FOUND'; end if;
  if v_reservation.state <> 'active' then raise exception 'BUDGET_RESERVATION_NOT_ACTIVE'; end if;
  update public.budget_reservations set state = 'settled', settled_at = now() where id = p_reservation_id;
  insert into public.usage_ledger (reservation_id, campaign_id, category, owner_id, run_id, provider, actual_nano, usage)
  values (p_reservation_id, v_reservation.campaign_id, v_reservation.category, v_reservation.owner_id, v_reservation.run_id, v_reservation.provider, p_actual_nano, p_usage);
end;
$$;

create or replace function public.mark_budget_charge_uncertain(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.budget_reservations set state = 'charge_uncertain'
    where id = p_reservation_id and state = 'active';
  if not found then raise exception 'BUDGET_RESERVATION_NOT_ACTIVE'; end if;
end;
$$;

revoke all on function public.reserve_budget(uuid, text, uuid, uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.settle_budget_reservation(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.mark_budget_charge_uncertain(uuid) from public, anon, authenticated;

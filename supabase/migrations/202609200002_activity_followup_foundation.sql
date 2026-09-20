-- Specification v1.3 / D12: owner-confirmed, opt-in administrative activity follow-up.
-- These tables are private. Public notice and moderator tables must never expose activity rows.

create type public.activity_confirmation_state as enum ('candidate', 'owner_confirmed', 'evidence_supported');
create type public.activity_tracking_state as enum ('active', 'paused', 'ended');
create type public.followup_action_state as enum (
  'needs_clarification', 'available', 'preparing', 'awaiting_review', 'submitted',
  'completed', 'dismissed', 'expired', 'not_applicable'
);

create table public.tracked_activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  activity_type text not null check (char_length(activity_type) between 1 and 120),
  institution_id uuid references public.institutions(id),
  program_id uuid references public.programs(id),
  title text not null check (char_length(title) between 1 and 200),
  scope_json jsonb not null default '{}'::jsonb,
  typed_facts_json jsonb not null default '{}'::jsonb,
  stage text,
  external_status text,
  protected_identifier text,
  expires_at timestamptz,
  expires_at_provenance jsonb,
  next_due_at timestamptz,
  next_due_at_provenance jsonb,
  confirmation_state public.activity_confirmation_state not null default 'candidate',
  tracking_state public.activity_tracking_state not null default 'paused',
  source_application_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0 check (row_version >= 0),
  foreign key (owner_id, source_application_id) references public.applications(owner_id, id) on delete set null,
  unique (owner_id, id),
  check (tracking_state <> 'active' or confirmation_state in ('owner_confirmed', 'evidence_supported'))
);

create table public.activity_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  activity_id uuid not null,
  evidence_kind text not null check (evidence_kind in ('document_version', 'submission_evidence', 'owner_record')),
  evidence_version_id uuid,
  supported_facts jsonb not null default '{}'::jsonb,
  confirmation_actor text check (confirmation_actor in ('owner', 'system', 'worker')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (owner_id, activity_id) references public.tracked_activities(owner_id, id) on delete cascade,
  unique (owner_id, id),
  check ((evidence_kind = 'owner_record') = (evidence_version_id is null))
);

create table public.activity_fact_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  activity_id uuid not null,
  fact_key text not null check (fact_key ~ '^[a-z][a-z0-9_.-]{0,119}$'),
  value_json jsonb not null,
  provenance_kind text not null check (provenance_kind in ('evidence', 'owner_assertion', 'owner_confirmation')),
  source_activity_evidence_id uuid,
  confirmation_state text not null check (confirmation_state in ('proposed', 'confirmed', 'conflicted')),
  supersedes_id uuid references public.activity_fact_versions(id),
  created_at timestamptz not null default now(),
  foreign key (owner_id, activity_id) references public.tracked_activities(owner_id, id) on delete cascade,
  foreign key (owner_id, source_activity_evidence_id) references public.activity_evidence(owner_id, id),
  unique (owner_id, id),
  check (provenance_kind = 'evidence' or source_activity_evidence_id is null)
);

create table public.activity_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  activity_id uuid not null,
  enabled boolean not null default true,
  explicit_opt_in_at timestamptz not null,
  source_coverage_ids jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0 check (row_version >= 0),
  foreign key (owner_id, activity_id) references public.tracked_activities(owner_id, id) on delete cascade,
  unique (owner_id, activity_id)
);

create table public.followup_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  activity_id uuid not null,
  action_family_key text not null check (action_family_key ~ '^[a-z][a-z0-9_.-]{0,119}$'),
  action_period text not null check (char_length(action_period) between 1 and 120),
  current_notice_version_id uuid,
  trigger_kind text not null check (trigger_kind in ('verified_notice', 'due_date', 'expiry_date', 'owner_reminder')),
  trigger_evidence_version_id uuid,
  kind text not null check (char_length(kind) between 1 and 120),
  applicability_result text not null check (applicability_result in ('pass', 'fail', 'unknown', 'not_applicable')),
  cited_reason jsonb not null default '{}'::jsonb,
  deadline_at timestamptz,
  deadline_text text,
  state public.followup_action_state not null default 'needs_clarification',
  linked_application_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0 check (row_version >= 0),
  foreign key (owner_id, activity_id) references public.tracked_activities(owner_id, id) on delete cascade,
  foreign key (owner_id, linked_application_id) references public.applications(owner_id, id) on delete set null,
  unique (activity_id, action_family_key, action_period),
  unique (owner_id, id),
  check (trigger_kind = 'verified_notice' or trigger_evidence_version_id is not null)
);

alter table public.applications add column activity_id uuid;
alter table public.applications add column followup_action_id uuid;
alter table public.applications
  add constraint applications_activity_owner_fk
  foreign key (owner_id, activity_id) references public.tracked_activities(owner_id, id) on delete set null;
alter table public.applications
  add constraint applications_followup_action_owner_fk
  foreign key (owner_id, followup_action_id) references public.followup_actions(owner_id, id) on delete set null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid,
  activity_id uuid,
  followup_action_id uuid,
  event_type text not null,
  dedupe_key text not null,
  minimal_text text not null,
  deep_link text,
  read_at timestamptz,
  actionable_status text,
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade,
  foreign key (owner_id, activity_id) references public.tracked_activities(owner_id, id) on delete cascade,
  foreign key (owner_id, followup_action_id) references public.followup_actions(owner_id, id) on delete cascade,
  unique (owner_id, dedupe_key),
  check (application_id is not null or activity_id is not null)
);

create index tracked_activities_owner_state_idx on public.tracked_activities (owner_id, tracking_state, updated_at desc);
create index activity_subscriptions_active_idx on public.activity_subscriptions (activity_id) where enabled;
create index followup_actions_owner_state_idx on public.followup_actions (owner_id, state, deadline_at);
create index followup_actions_activity_period_idx on public.followup_actions (activity_id, action_family_key, action_period);
create index notifications_owner_unread_idx on public.notifications (owner_id, created_at desc) where read_at is null;

create trigger tracked_activities_touch before update on public.tracked_activities for each row execute procedure public.touch_mutable_row();
create trigger activity_subscriptions_touch before update on public.activity_subscriptions for each row execute procedure public.touch_mutable_row();
create trigger followup_actions_touch before update on public.followup_actions for each row execute procedure public.touch_mutable_row();

alter table public.tracked_activities enable row level security;
alter table public.activity_evidence enable row level security;
alter table public.activity_fact_versions enable row level security;
alter table public.activity_subscriptions enable row level security;
alter table public.followup_actions enable row level security;
alter table public.notifications enable row level security;

create policy tracked_activities_owner_read on public.tracked_activities for select using (owner_id = auth.uid());
create policy activity_evidence_owner_read on public.activity_evidence for select using (owner_id = auth.uid());
create policy activity_fact_versions_owner_read on public.activity_fact_versions for select using (owner_id = auth.uid());
create policy activity_subscriptions_owner_read on public.activity_subscriptions for select using (owner_id = auth.uid());
create policy followup_actions_owner_read on public.followup_actions for select using (owner_id = auth.uid());
create policy notifications_owner_read on public.notifications for select using (owner_id = auth.uid());

-- State transitions and monitoring consent are server-validated transactions, not direct client table writes.
grant select on public.tracked_activities, public.activity_evidence, public.activity_fact_versions,
  public.activity_subscriptions, public.followup_actions, public.notifications to authenticated;

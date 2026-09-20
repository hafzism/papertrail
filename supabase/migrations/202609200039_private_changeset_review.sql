-- COMMIT foundation: owner-created external-action envelopes are immutable,
-- reviewable and approval-bound. This migration deliberately does not execute a
-- browser action; execution needs a separately configured provider.
create table public.changesets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  prerequisite_vector jsonb not null default '{}'::jsonb check (jsonb_typeof(prerequisite_vector) = 'object'),
  state text not null default 'review_required' check (state in ('review_required', 'approved', 'stale', 'executed', 'outcome_unknown', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  row_version integer not null default 0 check (row_version >= 0),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);
create index changesets_owner_application_created_idx on public.changesets (owner_id, application_id, created_at desc);
alter table public.changesets enable row level security;
create policy changesets_owner_read on public.changesets for select using (owner_id = auth.uid());
revoke all on public.changesets from public, anon, authenticated;
grant select on public.changesets to authenticated;

create or replace function public.create_private_changeset(
  p_application_id uuid, p_destination_origin text, p_destination_path text, p_action_kind text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_payload jsonb;
  v_id uuid;
  v_sequence bigint;
begin
  if v_owner_id is null then raise exception 'CHANGESET_AUTH_REQUIRED'; end if;
  if p_destination_origin !~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$' then raise exception 'CHANGESET_DESTINATION_HTTPS_REQUIRED'; end if;
  if p_destination_path !~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$' then raise exception 'CHANGESET_DESTINATION_PATH_INVALID'; end if;
  if p_action_kind not in ('disclose_fields', 'upload_attachment', 'save_draft', 'submit', 'send_institution_message') then raise exception 'CHANGESET_ACTION_INVALID'; end if;
  perform 1 from public.applications where id = p_application_id and owner_id = v_owner_id and lifecycle_state in ('draft', 'prepared') for share;
  if not found then raise exception 'CHANGESET_APPLICATION_NOT_REVIEWABLE_OR_NOT_FOUND'; end if;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'applicationId', p_application_id,
    'destination', jsonb_build_object('origin', p_destination_origin, 'path', p_destination_path, 'accountLabel', null),
    'actions', jsonb_build_array(jsonb_build_object(
      'id', 'owner-action-1', 'kind', p_action_kind, 'dependsOn', '[]'::jsonb,
      'expectedObservation', 'Owner must review the observed portal state before any external action.', 'reversible', p_action_kind <> 'submit'
    )),
    'prerequisites', '[]'::jsonb,
    'applicableRuleSetHash', repeat('0', 64), 'portalSchemaHash', repeat('0', 64),
    'expiresAt', to_char(now() + interval '30 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF')
  );
  insert into public.changesets (owner_id, application_id, payload, payload_sha256, prerequisite_vector, expires_at)
  values (v_owner_id, p_application_id, v_payload, encode(digest(v_payload::text, 'sha256'), 'hex'),
    jsonb_build_object('applicationMaterialVersion', (select material_version from public.applications where id = p_application_id and owner_id = v_owner_id)),
    now() + interval '30 minutes') returning id into v_id;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (v_owner_id, p_application_id, v_sequence, 'owner', 'changeset_review_created', 'External action review created', jsonb_build_object('changesetId', v_id));
  return v_id;
end;
$$;

create or replace function public.approve_private_changeset(p_changeset_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner_id uuid := auth.uid(); v_application_id uuid; v_sequence bigint;
begin
  if v_owner_id is null then raise exception 'CHANGESET_AUTH_REQUIRED'; end if;
  update public.changesets as changeset set state = 'approved', approved_at = now(), row_version = row_version + 1
  where changeset.id = p_changeset_id and changeset.owner_id = v_owner_id and changeset.state = 'review_required'
    and changeset.expires_at > now()
    and changeset.prerequisite_vector = jsonb_build_object('applicationMaterialVersion', (
      select application.material_version from public.applications as application
      where application.id = changeset.application_id and application.owner_id = v_owner_id
    ))
  returning changeset.application_id into v_application_id;
  if v_application_id is null then return false; end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = v_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (v_owner_id, v_application_id, v_sequence, 'owner', 'changeset_approved', 'Exact external action envelope approved', jsonb_build_object('changesetId', p_changeset_id));
  return true;
end;
$$;
revoke all on function public.create_private_changeset(uuid, text, text, text) from public, anon;
grant execute on function public.create_private_changeset(uuid, text, text, text) to authenticated;
revoke all on function public.approve_private_changeset(uuid) from public, anon;
grant execute on function public.approve_private_changeset(uuid) to authenticated;

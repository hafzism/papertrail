-- A fully local, labelled reference-portal flow exercises the same immutable
-- changeset/approval boundary without representing an external institution.
create table public.reference_portal_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  changeset_id uuid not null unique references public.changesets(id) on delete cascade,
  reference_code text not null unique,
  payload_sha256 text not null check (payload_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);
create index reference_portal_receipts_owner_application_created_idx on public.reference_portal_receipts (owner_id, application_id, created_at desc);
alter table public.reference_portal_receipts enable row level security;
create policy reference_portal_receipts_owner_read on public.reference_portal_receipts for select using (owner_id = auth.uid());
revoke all on public.reference_portal_receipts from public, anon, authenticated;
grant select on public.reference_portal_receipts to authenticated;

create or replace function public.create_reference_portal_changeset(
  p_application_id uuid, p_demo_name text, p_applicant_type text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_payload jsonb;
  v_id uuid;
  v_sequence bigint;
  v_name text := btrim(coalesce(p_demo_name, ''));
  v_type text := btrim(coalesce(p_applicant_type, ''));
begin
  if v_owner_id is null then raise exception 'REFERENCE_PORTAL_AUTH_REQUIRED'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 200 or v_type not in ('student', 'community-member') then
    raise exception 'REFERENCE_PORTAL_PAYLOAD_INVALID';
  end if;
  perform 1 from public.applications where id = p_application_id and owner_id = v_owner_id and lifecycle_state in ('draft', 'prepared') for share;
  if not found then raise exception 'REFERENCE_PORTAL_APPLICATION_NOT_REVIEWABLE'; end if;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'applicationId', p_application_id,
    'destination', jsonb_build_object('origin', 'papertrail-reference-portal', 'path', '/reference-portal', 'accountLabel', 'Fictional local demo'),
    'actions', jsonb_build_array(jsonb_build_object(
      'id', 'reference-demo-submit', 'kind', 'submit', 'dependsOn', '[]'::jsonb,
      'fieldValues', jsonb_build_object('applicantName', v_name, 'applicantType', v_type),
      'declarations', jsonb_build_array(jsonb_build_object('text', 'I understand this is a fictional reference portal and am using test data only.', 'userAttestationRequired', true)),
      'expectedObservation', 'A browser-local, fictional demo acknowledgement reference is recorded.', 'reversible', false
    )),
    'prerequisites', '[]'::jsonb, 'applicableRuleSetHash', repeat('0', 64), 'portalSchemaHash', repeat('0', 64),
    'expiresAt', to_char(now() + interval '30 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF')
  );
  insert into public.changesets (owner_id, application_id, payload, payload_sha256, prerequisite_vector, expires_at)
    values (v_owner_id, p_application_id, v_payload, encode(digest(v_payload::text, 'sha256'), 'hex'),
      jsonb_build_object('applicationMaterialVersion', (select material_version from public.applications where id = p_application_id and owner_id = v_owner_id)), now() + interval '30 minutes')
    returning id into v_id;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
    values (v_owner_id, p_application_id, v_sequence, 'owner', 'reference_portal_changeset_created', 'Fictional reference-portal demo review created', jsonb_build_object('changesetId', v_id));
  return v_id;
end;
$$;

create or replace function public.execute_reference_portal_changeset(p_changeset_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_changeset public.changesets%rowtype;
  v_reference text;
  v_sequence bigint;
begin
  if v_owner_id is null then raise exception 'REFERENCE_PORTAL_AUTH_REQUIRED'; end if;
  select * into v_changeset from public.changesets where id = p_changeset_id and owner_id = v_owner_id for update;
  if not found then raise exception 'REFERENCE_PORTAL_CHANGESET_NOT_FOUND'; end if;
  if v_changeset.state <> 'approved' or v_changeset.expires_at <= now() then raise exception 'REFERENCE_PORTAL_CHANGESET_NOT_EXECUTABLE'; end if;
  if v_changeset.prerequisite_vector <> jsonb_build_object('applicationMaterialVersion', (
    select material_version from public.applications where id = v_changeset.application_id and owner_id = v_owner_id
  )) then raise exception 'REFERENCE_PORTAL_CHANGESET_STALE'; end if;
  if v_changeset.payload #>> '{destination,origin}' <> 'papertrail-reference-portal'
    or v_changeset.payload #>> '{destination,path}' <> '/reference-portal'
    or v_changeset.payload #>> '{actions,0,kind}' <> 'submit'
    or coalesce(v_changeset.payload #>> '{actions,0,fieldValues,applicantName}', '') = ''
    or v_changeset.payload #>> '{actions,0,fieldValues,applicantType}' not in ('student', 'community-member') then
    raise exception 'REFERENCE_PORTAL_CHANGESET_PAYLOAD_INVALID';
  end if;
  v_reference := 'DEMO-' || to_char(now() at time zone 'UTC', 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.reference_portal_receipts (owner_id, application_id, changeset_id, reference_code, payload_sha256)
    values (v_owner_id, v_changeset.application_id, v_changeset.id, v_reference, v_changeset.payload_sha256);
  update public.changesets set state = 'executed', row_version = row_version + 1 where id = v_changeset.id;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = v_changeset.application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
    values (v_owner_id, v_changeset.application_id, v_sequence, 'system', 'reference_portal_demo_acknowledged', 'Fictional local reference-portal acknowledgement recorded', jsonb_build_object('changesetId', v_changeset.id, 'referenceCode', v_reference));
  return v_reference;
end;
$$;
revoke all on function public.create_reference_portal_changeset(uuid, text, text) from public, anon;
grant execute on function public.create_reference_portal_changeset(uuid, text, text) to authenticated;
revoke all on function public.execute_reference_portal_changeset(uuid) from public, anon;
grant execute on function public.execute_reference_portal_changeset(uuid) to authenticated;

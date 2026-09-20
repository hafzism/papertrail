-- Application-specific facts take precedence only within their own application. Like
-- profile facts, they are append-only owner-confirmed assertions, not inferred truth.

create table public.application_fact_overrides (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  fact_key text not null check (fact_key ~ '^[a-z][a-z0-9_.-]{0,119}$'),
  value_json jsonb not null check (jsonb_typeof(value_json) in ('string', 'number', 'boolean')),
  source_kind text not null check (source_kind in ('owner_assertion', 'document_extraction')),
  source_document_version_id uuid,
  confirmed_at timestamptz not null,
  supersedes_id uuid references public.application_fact_overrides(id),
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade,
  check ((source_kind = 'owner_assertion' and source_document_version_id is null) or source_kind = 'document_extraction')
);
create index application_fact_overrides_owner_application_key_created_idx on public.application_fact_overrides (owner_id, application_id, fact_key, created_at desc);
alter table public.application_fact_overrides enable row level security;
create policy application_fact_overrides_owner_read on public.application_fact_overrides for select using (owner_id = auth.uid());
revoke all on public.application_fact_overrides from public, anon, authenticated;
grant select on public.application_fact_overrides to authenticated;

create or replace function public.record_application_fact_override(p_application_id uuid, p_fact_key text, p_value_json jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_override_id uuid;
  v_supersedes_id uuid;
  v_sequence bigint;
begin
  if v_owner_id is null then raise exception 'APPLICATION_FACT_UNAUTHENTICATED'; end if;
  if trim(p_fact_key) !~ '^[a-z][a-z0-9_.-]{0,119}$' then raise exception 'APPLICATION_FACT_INVALID_KEY'; end if;
  if jsonb_typeof(p_value_json) not in ('string', 'number', 'boolean') then raise exception 'APPLICATION_FACT_INVALID_VALUE'; end if;
  if jsonb_typeof(p_value_json) = 'string' and char_length(p_value_json #>> '{}') not between 1 and 500 then raise exception 'APPLICATION_FACT_INVALID_VALUE'; end if;
  perform 1 from public.applications where id = p_application_id and owner_id = v_owner_id and lifecycle_state = 'draft' for update;
  if not found then raise exception 'APPLICATION_FACT_APPLICATION_NOT_DRAFT_OR_NOT_FOUND'; end if;
  select id into v_supersedes_id from public.application_fact_overrides
    where owner_id = v_owner_id and application_id = p_application_id and fact_key = trim(p_fact_key)
    order by created_at desc, id desc limit 1;
  insert into public.application_fact_overrides (
    owner_id, application_id, fact_key, value_json, source_kind, confirmed_at, supersedes_id
  ) values (
    v_owner_id, p_application_id, trim(p_fact_key), p_value_json, 'owner_assertion', now(), v_supersedes_id
  ) returning id into v_override_id;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
  values (v_owner_id, p_application_id, v_sequence, 'owner', 'application_fact_override_recorded',
    'Owner-confirmed application-specific fact recorded', jsonb_build_object('applicationFactOverrideId', v_override_id, 'factKey', trim(p_fact_key)));
  return v_override_id;
end;
$$;

revoke all on function public.record_application_fact_override(uuid, text, jsonb) from public, anon;
grant execute on function public.record_application_fact_override(uuid, text, jsonb) to authenticated;

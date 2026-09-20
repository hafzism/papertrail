-- Facts are append-only owner-confirmed records. They are not inferred from a model,
-- and an owner assertion is deliberately distinct from institutional verification.

create table public.profile_fact_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  fact_key text not null check (fact_key ~ '^[a-z][a-z0-9_.-]{0,119}$'),
  value_json jsonb not null check (jsonb_typeof(value_json) in ('string', 'number', 'boolean')),
  source_kind text not null check (source_kind in ('owner_assertion', 'document_extraction')),
  source_document_version_id uuid,
  confirmation_state text not null check (confirmation_state in ('owner_confirmed', 'pending_review', 'rejected')),
  confirmed_at timestamptz,
  supersedes_id uuid references public.profile_fact_versions(id),
  created_at timestamptz not null default now(),
  check (
    (confirmation_state = 'owner_confirmed' and confirmed_at is not null)
    or (confirmation_state <> 'owner_confirmed' and confirmed_at is null)
  ),
  check (
    (source_kind = 'owner_assertion' and source_document_version_id is null)
    or source_kind = 'document_extraction'
  )
);
create index profile_fact_versions_owner_key_created_idx on public.profile_fact_versions (owner_id, fact_key, created_at desc);
alter table public.profile_fact_versions enable row level security;
create policy profile_fact_versions_owner_read on public.profile_fact_versions for select using (owner_id = auth.uid());
revoke all on public.profile_fact_versions from public, anon, authenticated;
grant select on public.profile_fact_versions to authenticated;

create or replace function public.record_owner_profile_fact(p_fact_key text, p_value_json jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_fact_id uuid;
  v_supersedes_id uuid;
begin
  if v_owner_id is null then raise exception 'PROFILE_FACT_UNAUTHENTICATED'; end if;
  if trim(p_fact_key) !~ '^[a-z][a-z0-9_.-]{0,119}$' then raise exception 'PROFILE_FACT_INVALID_KEY'; end if;
  if jsonb_typeof(p_value_json) not in ('string', 'number', 'boolean') then raise exception 'PROFILE_FACT_INVALID_VALUE'; end if;
  if jsonb_typeof(p_value_json) = 'string' and char_length(p_value_json #>> '{}') not between 1 and 500 then raise exception 'PROFILE_FACT_INVALID_VALUE'; end if;

  perform 1 from public.profiles where user_id = v_owner_id for share;
  if not found then raise exception 'PROFILE_FACT_PROFILE_MISSING'; end if;
  select id into v_supersedes_id
  from public.profile_fact_versions
  where owner_id = v_owner_id and fact_key = trim(p_fact_key) and confirmation_state = 'owner_confirmed'
  order by created_at desc, id desc limit 1;
  insert into public.profile_fact_versions (
    owner_id, fact_key, value_json, source_kind, confirmation_state, confirmed_at, supersedes_id
  ) values (
    v_owner_id, trim(p_fact_key), p_value_json, 'owner_assertion', 'owner_confirmed', now(), v_supersedes_id
  ) returning id into v_fact_id;
  return v_fact_id;
end;
$$;

revoke all on function public.record_owner_profile_fact(text, jsonb) from public, anon;
grant execute on function public.record_owner_profile_fact(text, jsonb) to authenticated;

-- Shared directory contributions are deliberately separate from private application
-- research. Only a notice moderator can publish a proposal, and publication never
-- exposes the contributor's private application, evidence, or account details.
create table public.directory_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  institution_name text not null check (char_length(institution_name) between 2 and 200),
  program_name text not null check (char_length(program_name) between 2 and 200),
  cycle_label text not null check (char_length(cycle_label) between 1 and 120),
  jurisdiction text check (jurisdiction is null or char_length(jurisdiction) <= 120),
  category text check (category is null or char_length(category) <= 120),
  starts_on date,
  ends_on date,
  source_url text not null check (char_length(source_url) <= 2048),
  state text not null default 'submitted' check (state in ('submitted', 'approved', 'rejected')),
  moderator_note text check (moderator_note is null or char_length(moderator_note) <= 1000),
  published_program_id uuid references public.programs(id) on delete set null,
  reviewed_by uuid references public.profiles(user_id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index directory_proposals_owner_created_idx on public.directory_proposals (owner_id, created_at desc);
create index directory_proposals_pending_idx on public.directory_proposals (created_at) where state = 'submitted';

create table public.published_program_sources (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  proposal_id uuid not null unique references public.directory_proposals(id) on delete cascade,
  source_url text not null check (char_length(source_url) <= 2048),
  published_at timestamptz not null default now(),
  unique (program_id, source_url)
);
create index published_program_sources_program_idx on public.published_program_sources (program_id, published_at desc);

alter table public.directory_proposals enable row level security;
alter table public.published_program_sources enable row level security;
create policy directory_proposals_owner_read on public.directory_proposals for select using (owner_id = auth.uid());
create policy directory_proposals_moderator_read on public.directory_proposals for select using (public.is_notice_moderator());
create policy published_program_sources_read on public.published_program_sources for select using (true);
revoke all on public.directory_proposals, public.published_program_sources from public, anon, authenticated;
grant select on public.directory_proposals, public.published_program_sources to authenticated;

create or replace function public.submit_directory_proposal(
  p_institution_name text,
  p_program_name text,
  p_cycle_label text,
  p_source_url text,
  p_jurisdiction text default null,
  p_category text default null,
  p_starts_on date default null,
  p_ends_on date default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_id uuid;
  v_url text := btrim(p_source_url);
begin
  if v_owner_id is null then raise exception 'DIRECTORY_PROPOSAL_AUTH_REQUIRED'; end if;
  if btrim(coalesce(p_institution_name, '')) = '' or btrim(coalesce(p_program_name, '')) = '' or btrim(coalesce(p_cycle_label, '')) = '' then
    raise exception 'DIRECTORY_PROPOSAL_REQUIRED_FIELDS';
  end if;
  if v_url !~ '^https://[^/@[:space:]]+(?:/.*)?$' then raise exception 'DIRECTORY_PROPOSAL_HTTPS_REQUIRED'; end if;
  if p_ends_on is not null and p_starts_on is not null and p_ends_on < p_starts_on then raise exception 'DIRECTORY_PROPOSAL_DATES_INVALID'; end if;
  insert into public.directory_proposals (
    owner_id, institution_name, program_name, cycle_label, source_url, jurisdiction, category, starts_on, ends_on
  ) values (
    v_owner_id, btrim(p_institution_name), btrim(p_program_name), btrim(p_cycle_label), v_url,
    nullif(btrim(p_jurisdiction), ''), nullif(btrim(p_category), ''), p_starts_on, p_ends_on
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.moderate_directory_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_moderator_note text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_moderator_id uuid := auth.uid();
  v_proposal public.directory_proposals%rowtype;
  v_institution_id uuid;
  v_program_id uuid;
  v_slug text;
begin
  if v_moderator_id is null or not public.is_notice_moderator() then raise exception 'DIRECTORY_MODERATOR_REQUIRED'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'DIRECTORY_DECISION_INVALID'; end if;
  if char_length(coalesce(p_moderator_note, '')) > 1000 then raise exception 'DIRECTORY_MODERATION_NOTE_INVALID'; end if;
  select * into v_proposal from public.directory_proposals where id = p_proposal_id for update;
  if not found then raise exception 'DIRECTORY_PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.state <> 'submitted' then raise exception 'DIRECTORY_PROPOSAL_ALREADY_REVIEWED'; end if;
  if p_decision = 'rejected' then
    update public.directory_proposals set state = 'rejected', moderator_note = nullif(btrim(p_moderator_note), ''), reviewed_by = v_moderator_id, reviewed_at = now()
      where id = v_proposal.id;
    return null;
  end if;

  select id into v_institution_id from public.institutions where lower(name) = lower(v_proposal.institution_name) order by created_at asc limit 1 for update;
  if v_institution_id is null then
    insert into public.institutions (name) values (v_proposal.institution_name) returning id into v_institution_id;
  end if;
  v_slug := trim(both '-' from regexp_replace(lower(v_proposal.program_name), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then v_slug := 'program'; end if;
  v_slug := left(v_slug, 80) || '-' || substr(encode(digest(v_proposal.program_name, 'sha256'), 'hex'), 1, 12);
  select id into v_program_id from public.programs where institution_id = v_institution_id and canonical_slug = v_slug for update;
  if v_program_id is null then
    insert into public.programs (institution_id, name, jurisdiction, category, canonical_slug)
      values (v_institution_id, v_proposal.program_name, v_proposal.jurisdiction, v_proposal.category, v_slug)
      returning id into v_program_id;
  end if;
  insert into public.program_cycles (program_id, cycle_label, starts_on, ends_on)
    values (v_program_id, v_proposal.cycle_label, v_proposal.starts_on, v_proposal.ends_on)
    on conflict (program_id, cycle_label) do nothing;
  insert into public.published_program_sources (program_id, proposal_id, source_url)
    values (v_program_id, v_proposal.id, v_proposal.source_url);
  update public.directory_proposals set state = 'approved', moderator_note = nullif(btrim(p_moderator_note), ''),
    published_program_id = v_program_id, reviewed_by = v_moderator_id, reviewed_at = now() where id = v_proposal.id;
  return v_program_id;
end;
$$;

revoke all on function public.submit_directory_proposal(text, text, text, text, text, text, date, date) from public, anon;
grant execute on function public.submit_directory_proposal(text, text, text, text, text, text, date, date) to authenticated;
revoke all on function public.moderate_directory_proposal(uuid, text, text) from public, anon;
grant execute on function public.moderate_directory_proposal(uuid, text, text) to authenticated;

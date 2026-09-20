-- Persistent, owner-authored application conversation. Notes are private context,
-- not extracted requirements, institutional messages, or model assertions.
create table public.application_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);
create index application_notes_owner_application_created_idx on public.application_notes (owner_id, application_id, created_at desc);
alter table public.application_notes enable row level security;
create policy application_notes_owner_read on public.application_notes for select using (owner_id = auth.uid());
revoke all on public.application_notes from public, anon, authenticated;
grant select on public.application_notes to authenticated;

create or replace function public.add_application_note(p_application_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_note_id uuid;
  v_sequence bigint;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_owner_id is null then raise exception 'APPLICATION_NOTE_AUTH_REQUIRED'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then raise exception 'APPLICATION_NOTE_BODY_INVALID'; end if;
  perform 1 from public.applications where id = p_application_id and owner_id = v_owner_id for share;
  if not found then raise exception 'APPLICATION_NOTE_APPLICATION_NOT_FOUND'; end if;
  insert into public.application_notes (owner_id, application_id, body)
    values (v_owner_id, p_application_id, v_body) returning id into v_note_id;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
  insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
    values (v_owner_id, p_application_id, v_sequence, 'owner', 'application_note_recorded', 'Private application note recorded', jsonb_build_object('noteId', v_note_id));
  return v_note_id;
end;
$$;
revoke all on function public.add_application_note(uuid, text) from public, anon;
grant execute on function public.add_application_note(uuid, text) to authenticated;

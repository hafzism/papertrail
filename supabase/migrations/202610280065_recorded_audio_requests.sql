create table public.audio_transcription_requests(
  id uuid primary key,
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  audio_sha256 text not null check(audio_sha256 ~ '^[a-f0-9]{64}$'),
  duration_seconds numeric not null check(duration_seconds>0 and duration_seconds<=300),
  state text not null default 'running' check(state in ('running','completed','failed')),
  transcript text,
  created_at timestamptz not null default now(),
  foreign key(owner_id,application_id) references public.applications(owner_id,id) on delete cascade
);
alter table public.audio_transcription_requests enable row level security;
create policy audio_requests_owner_read on public.audio_transcription_requests for select using(owner_id=auth.uid());
revoke all on public.audio_transcription_requests from public,anon,authenticated;
grant select on public.audio_transcription_requests to authenticated;
grant all on public.audio_transcription_requests to service_role;

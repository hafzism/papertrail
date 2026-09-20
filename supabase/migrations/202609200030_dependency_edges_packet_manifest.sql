-- W4 foundation: a private, application-scoped DAG links immutable requirement
-- and binding inputs to review-only artifacts. It is intentionally not client writable.

create table public.dependency_edges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  from_type text not null check (from_type in ('private_requirement', 'evidence_binding', 'artifact')),
  from_id uuid not null,
  from_version text not null check (char_length(from_version) between 1 and 160),
  to_type text not null check (to_type in ('private_requirement', 'evidence_binding', 'artifact')),
  to_id uuid not null,
  to_version text not null check (char_length(to_version) between 1 and 160),
  relation text not null check (char_length(relation) between 1 and 120),
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade,
  check (from_type <> to_type or from_id <> to_id or from_version <> to_version),
  unique (owner_id, application_id, from_type, from_id, from_version, to_type, to_id, to_version, relation)
);

create index dependency_edges_reverse_lookup_idx
  on public.dependency_edges (owner_id, application_id, from_type, from_id);
create index dependency_edges_descendant_lookup_idx
  on public.dependency_edges (owner_id, application_id, to_type, to_id);

alter table public.dependency_edges enable row level security;
create policy dependency_edges_owner_read on public.dependency_edges for select using (owner_id = auth.uid());
revoke all on public.dependency_edges from public, anon, authenticated;
grant select on public.dependency_edges to authenticated;

create or replace function public.reject_dependency_edge_cycle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (
    with recursive descendants(type, id, version) as (
      select edge.to_type, edge.to_id, edge.to_version
      from public.dependency_edges as edge
      where edge.owner_id = new.owner_id and edge.application_id = new.application_id
        and edge.from_type = new.to_type and edge.from_id = new.to_id and edge.from_version = new.to_version
      union
      select edge.to_type, edge.to_id, edge.to_version
      from public.dependency_edges as edge
      join descendants on edge.from_type = descendants.type and edge.from_id = descendants.id and edge.from_version = descendants.version
      where edge.owner_id = new.owner_id and edge.application_id = new.application_id
    )
    select 1 from descendants
    where type = new.from_type and id = new.from_id and version = new.from_version
  ) then
    raise exception 'DEPENDENCY_EDGE_CYCLE';
  end if;
  return new;
end;
$$;

create trigger dependency_edges_reject_cycle
before insert on public.dependency_edges
for each row execute procedure public.reject_dependency_edge_cycle();

-- Packet-manifest recording is the first producer. The trigger derives edges from
-- the immutable input vector already rechecked by the fenced worker transaction.
create or replace function public.link_packet_manifest_dependencies()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_requirement jsonb;
  v_binding jsonb;
  v_requirement_version text;
begin
  if new.kind <> 'packet_manifest' then return new; end if;
  for v_requirement in select value from jsonb_array_elements(coalesce(new.input_version_vector->'requirements', '[]'::jsonb)) loop
    v_requirement_version := coalesce(v_requirement->>'citationSourceHash', 'unversioned');
    insert into public.dependency_edges (
      owner_id, application_id, from_type, from_id, from_version, to_type, to_id, to_version, relation
    ) values (
      new.owner_id, new.application_id, 'private_requirement', (v_requirement->>'id')::uuid, v_requirement_version,
      'artifact', new.id, new.sha256, 'included_in_packet_manifest'
    ) on conflict do nothing;
  end loop;
  for v_binding in select value from jsonb_array_elements(coalesce(new.input_version_vector->'bindings', '[]'::jsonb)) loop
    insert into public.dependency_edges (
      owner_id, application_id, from_type, from_id, from_version, to_type, to_id, to_version, relation
    ) values (
      new.owner_id, new.application_id, 'evidence_binding', (v_binding->>'id')::uuid, coalesce(v_binding->>'state', 'unversioned'),
      'artifact', new.id, new.sha256, 'included_in_packet_manifest'
    ) on conflict do nothing;
  end loop;
  return new;
end;
$$;

create trigger artifacts_link_packet_manifest_dependencies
after insert on public.artifacts
for each row execute procedure public.link_packet_manifest_dependencies();

revoke all on function public.reject_dependency_edge_cycle() from public, anon, authenticated;
revoke all on function public.link_packet_manifest_dependencies() from public, anon, authenticated;

-- W4: apply a scoped internal stale transition to descendants of one immutable
-- dependency node. This never restores work or approves an external action.

create table public.application_impacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  application_id uuid not null,
  trigger_type text not null check (trigger_type in ('private_requirement', 'evidence_binding', 'artifact')),
  trigger_id uuid not null,
  trigger_version text not null check (char_length(trigger_version) between 1 and 160),
  reason text not null check (char_length(reason) between 1 and 1000),
  affected_node_ids jsonb not null default '[]'::jsonb,
  status text not null default 'applied' check (status in ('applied', 'no_affected_work')),
  created_at timestamptz not null default now(),
  foreign key (owner_id, application_id) references public.applications(owner_id, id) on delete cascade
);

create index application_impacts_owner_application_created_idx
  on public.application_impacts (owner_id, application_id, created_at desc);

alter table public.application_impacts enable row level security;
create policy application_impacts_owner_read on public.application_impacts for select using (owner_id = auth.uid());
revoke all on public.application_impacts from public, anon, authenticated;
grant select on public.application_impacts to authenticated;

create or replace function public.apply_private_dependency_impact(
  p_application_id uuid,
  p_trigger_type text,
  p_trigger_id uuid,
  p_trigger_version text,
  p_reason text
)
returns table (impact_id uuid, affected_artifact_ids uuid[])
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_affected_artifact_ids uuid[];
  v_affected_nodes jsonb;
  v_impact_id uuid;
  v_sequence bigint;
begin
  if v_owner_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_trigger_type not in ('private_requirement', 'evidence_binding', 'artifact') then raise exception 'DEPENDENCY_IMPACT_INVALID_TRIGGER'; end if;
  if char_length(coalesce(p_trigger_version, '')) not between 1 and 160 or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then
    raise exception 'DEPENDENCY_IMPACT_INVALID_INPUT';
  end if;
  perform 1 from public.applications
  where id = p_application_id and owner_id = v_owner_id
  for update;
  if not found then raise exception 'DEPENDENCY_IMPACT_APPLICATION_NOT_FOUND'; end if;

  with recursive descendants(type, id, version) as (
    select p_trigger_type, p_trigger_id, p_trigger_version
    union
    select edge.to_type, edge.to_id, edge.to_version
    from public.dependency_edges as edge
    join descendants on edge.from_type = descendants.type and edge.from_id = descendants.id and edge.from_version = descendants.version
    where edge.owner_id = v_owner_id and edge.application_id = p_application_id
  ), affected as (
    select distinct id from descendants where type = 'artifact'
  ), stale as (
    update public.artifacts as artifact
    set status = 'stale'
    where artifact.owner_id = v_owner_id and artifact.application_id = p_application_id
      and artifact.id in (select id from affected)
      and artifact.status <> 'stale'
    returning artifact.id
  )
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_affected_artifact_ids from stale;

  with recursive descendants(type, id, version) as (
    select p_trigger_type, p_trigger_id, p_trigger_version
    union
    select edge.to_type, edge.to_id, edge.to_version
    from public.dependency_edges as edge
    join descendants on edge.from_type = descendants.type and edge.from_id = descendants.id and edge.from_version = descendants.version
    where edge.owner_id = v_owner_id and edge.application_id = p_application_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('type', type, 'id', id, 'version', version) order by type, id, version), '[]'::jsonb)
  into v_affected_nodes from descendants;

  insert into public.application_impacts (
    owner_id, application_id, trigger_type, trigger_id, trigger_version, reason, affected_node_ids, status
  ) values (
    v_owner_id, p_application_id, p_trigger_type, p_trigger_id, p_trigger_version, btrim(p_reason), v_affected_nodes,
    case when coalesce(array_length(v_affected_artifact_ids, 1), 0) > 0 then 'applied' else 'no_affected_work' end
  ) returning id into v_impact_id;

  if coalesce(array_length(v_affected_artifact_ids, 1), 0) > 0 then
    update public.applications set readiness_state = 'stale'
    where id = p_application_id and owner_id = v_owner_id and readiness_state <> 'stale';
    select coalesce(max(sequence), 0) + 1 into v_sequence from public.application_events where application_id = p_application_id;
    insert into public.application_events (owner_id, application_id, sequence, actor_type, event_type, redacted_summary, related_ids)
    values (
      v_owner_id, p_application_id, v_sequence, 'system', 'dependency_impact_applied',
      'Dependent preparation was marked stale for review',
      jsonb_build_object('impactId', v_impact_id, 'affectedArtifactIds', to_jsonb(v_affected_artifact_ids))
    );
  end if;
  impact_id := v_impact_id;
  affected_artifact_ids := v_affected_artifact_ids;
  return next;
end;
$$;

revoke all on function public.apply_private_dependency_impact(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.apply_private_dependency_impact(uuid, text, uuid, text, text) to authenticated;

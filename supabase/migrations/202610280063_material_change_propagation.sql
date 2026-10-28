-- Material changes must invalidate approvals and in-flight answers automatically.
-- Existing immutable receipts and completed changesets are never rewritten.
create or replace function public.advance_application_material(p_owner uuid,p_application uuid,p_reason text,p_fact_key text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.applications set material_version=material_version+1 where owner_id=p_owner and id=p_application;
  if not found then return; end if;
  update public.changesets set state='stale',row_version=row_version+1 where owner_id=p_owner and application_id=p_application and state in ('review_required','approved');
  update public.application_assistant_turns set state='obsolete' where owner_id=p_owner and application_id=p_application and state in ('pending','running');
  if p_reason in ('requirement','binding','document') then
    update public.artifacts set status='stale' where owner_id=p_owner and application_id=p_application and kind='packet_manifest' and status<>'stale';
  elsif p_reason='fact' then
    update public.artifacts a set status='stale' where a.owner_id=p_owner and a.application_id=p_application and a.kind='filled_acroform' and a.status<>'stale'
      and exists(select 1 from jsonb_array_elements(coalesce(a.input_version_vector->'mappings','[]'::jsonb)) m where m->>'factKey'=p_fact_key);
  end if;
  update public.packet_exports e set status='stale' from public.artifacts a where e.owner_id=p_owner and a.owner_id=p_owner and a.id=e.manifest_artifact_id and a.status='stale' and e.status<>'stale';
end; $$;

create or replace function public.application_material_changed()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_reason text;
begin
  if tg_table_name='private_requirement_versions' then v_reason:='requirement';
  elsif tg_table_name='evidence_bindings' then v_reason:='binding';
  elsif tg_table_name='application_fact_overrides' then v_reason:='fact';
  else v_reason:='source'; end if;
  if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return new; end if;
  perform public.advance_application_material(new.owner_id,new.application_id,v_reason,case when v_reason='fact' then to_jsonb(new)->>'fact_key' else null end);
  return new;
end; $$;
create trigger requirement_material_changed after insert or update on public.private_requirement_versions for each row execute function public.application_material_changed();
create trigger binding_material_changed after insert or update on public.evidence_bindings for each row execute function public.application_material_changed();
create trigger override_material_changed after insert on public.application_fact_overrides for each row execute function public.application_material_changed();
create trigger source_material_changed after insert on public.private_notice_snapshots for each row execute function public.application_material_changed();

create or replace function public.profile_fact_material_changed()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_app uuid;
begin
  -- A profile correction only affects applications whose prepared forms or
  -- predicates actually depend on this key, and not application-specific overrides.
  for v_app in
    select distinct a.id from public.applications a where a.owner_id=new.owner_id
      and not exists(select 1 from public.application_fact_overrides o where o.owner_id=new.owner_id and o.application_id=a.id and o.fact_key=new.fact_key)
      and (exists(select 1 from public.artifacts f cross join lateral jsonb_array_elements(coalesce(f.input_version_vector->'mappings','[]'::jsonb)) m where f.owner_id=new.owner_id and f.application_id=a.id and m->>'factKey'=new.fact_key)
        or exists(select 1 from public.private_requirement_versions r cross join lateral jsonb_path_query(jsonb_build_array(r.predicate_json,r.applicability_json),'$.**.path') p where r.owner_id=new.owner_id and r.application_id=a.id and p #>> '{}'='facts.'||new.fact_key))
    order by a.id
  loop perform public.advance_application_material(new.owner_id,v_app,'fact',new.fact_key); end loop;
  return new;
end; $$;
create trigger profile_fact_material_changed after insert on public.profile_fact_versions for each row execute function public.profile_fact_material_changed();

create or replace function public.preserve_telegram_text()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if char_length(btrim(new.body))>0 then
    insert into public.telegram_inbound_messages(owner_id,telegram_update_id,telegram_chat_id,body) values(new.owner_id,new.telegram_update_id,new.telegram_chat_id,new.body) on conflict(telegram_update_id) do nothing;
  end if;
  return new;
end; $$;
create trigger telegram_preserve_text after insert on public.telegram_intake_requests for each row execute function public.preserve_telegram_text();

revoke all on function public.advance_application_material(uuid,uuid,text,text),public.application_material_changed(),public.profile_fact_material_changed(),public.preserve_telegram_text() from public,anon,authenticated;
grant execute on function public.advance_application_material(uuid,uuid,text,text) to postgres,service_role;

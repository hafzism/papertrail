-- Persist the same restricted predicate shape used by the contracts package. New
-- owner-entered items default to explicit manual review; no prose requirement can
-- silently become a pass/fail decision.

create or replace function public.is_valid_requirement_predicate(p_predicate jsonb, p_depth integer default 0)
returns boolean language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v_op text;
  v_child jsonb;
  v_value jsonb;
begin
  if p_depth > 8 or jsonb_typeof(p_predicate) <> 'object' then return false; end if;
  v_op := p_predicate->>'op';
  if v_op in ('all', 'any') then
    if (p_predicate - array['op', 'args']) <> '{}'::jsonb
      or jsonb_typeof(p_predicate->'args') <> 'array'
      or jsonb_array_length(p_predicate->'args') between 0 and 0
      or jsonb_array_length(p_predicate->'args') > 20 then return false; end if;
    for v_child in select value from jsonb_array_elements(p_predicate->'args') loop
      if not public.is_valid_requirement_predicate(v_child, p_depth + 1) then return false; end if;
    end loop;
    return true;
  end if;
  if v_op = 'not' then
    return (p_predicate - array['op', 'arg']) = '{}'::jsonb
      and public.is_valid_requirement_predicate(p_predicate->'arg', p_depth + 1);
  end if;
  if v_op = 'manual_review' then
    return (p_predicate - array['op', 'reason']) = '{}'::jsonb
      and jsonb_typeof(p_predicate->'reason') = 'string'
      and char_length(p_predicate->>'reason') between 1 and 500;
  end if;
  if v_op = 'exists' then
    return (p_predicate - array['op', 'path']) = '{}'::jsonb
      and jsonb_typeof(p_predicate->'path') = 'string'
      and p_predicate->>'path' ~ '^facts\.[a-z][a-z0-9_.-]*$';
  end if;
  if v_op in ('eq', 'neq', 'gte', 'gt', 'lte', 'lt') then
    v_value := p_predicate->'value';
    return (p_predicate - array['op', 'path', 'value', 'unit']) = '{}'::jsonb
      and jsonb_typeof(p_predicate->'path') = 'string'
      and p_predicate->>'path' ~ '^facts\.[a-z][a-z0-9_.-]*$'
      and jsonb_typeof(v_value) in ('string', 'number', 'boolean')
      and (not (p_predicate ? 'unit') or (jsonb_typeof(p_predicate->'unit') = 'string' and char_length(p_predicate->>'unit') between 1 and 32));
  end if;
  if v_op = 'in' then
    if (p_predicate - array['op', 'path', 'values']) <> '{}'::jsonb
      or jsonb_typeof(p_predicate->'path') <> 'string'
      or p_predicate->>'path' !~ '^facts\.[a-z][a-z0-9_.-]*$'
      or jsonb_typeof(p_predicate->'values') <> 'array'
      or jsonb_array_length(p_predicate->'values') between 0 and 0
      or jsonb_array_length(p_predicate->'values') > 100 then return false; end if;
    for v_value in select value from jsonb_array_elements(p_predicate->'values') loop
      if jsonb_typeof(v_value) not in ('string', 'number', 'boolean') then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.is_valid_requirement_ambiguity_flags(p_flags jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare v_flag jsonb;
begin
  if jsonb_typeof(p_flags) <> 'array' or jsonb_array_length(p_flags) > 20 then return false; end if;
  for v_flag in select value from jsonb_array_elements(p_flags) loop
    if jsonb_typeof(v_flag) <> 'string' or char_length(v_flag #>> '{}') not between 1 and 120 then return false; end if;
  end loop;
  return true;
end;
$$;

alter table public.private_requirement_versions
  add column predicate_json jsonb not null default '{"op":"manual_review","reason":"Requirement has not been reviewed."}'::jsonb,
  add column applicability_json jsonb not null default '{"op":"manual_review","reason":"Applicability has not been reviewed."}'::jsonb,
  add column effective_from date,
  add column ambiguity_flags jsonb not null default '[]'::jsonb,
  add constraint private_requirement_versions_predicate_check check (public.is_valid_requirement_predicate(predicate_json)),
  add constraint private_requirement_versions_applicability_check check (public.is_valid_requirement_predicate(applicability_json)),
  add constraint private_requirement_versions_ambiguity_flags_check check (public.is_valid_requirement_ambiguity_flags(ambiguity_flags));

revoke all on function public.is_valid_requirement_predicate(jsonb, integer) from public, anon, authenticated;
revoke all on function public.is_valid_requirement_ambiguity_flags(jsonb) from public, anon, authenticated;

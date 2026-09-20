-- An owner explicitly maps a reviewed, confirmed profile fact to one inspected
-- ordinary AcroForm field. This records a value snapshot only; it never modifies
-- the original PDF or authorizes external use.
create table public.document_form_field_mappings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  inspection_id uuid not null references public.document_form_inspections(id) on delete cascade,
  document_version_id uuid not null,
  field_name text not null check (char_length(trim(field_name)) between 1 and 300),
  profile_fact_version_id uuid not null references public.profile_fact_versions(id) on delete restrict,
  fact_key text not null check (fact_key ~ '^[a-z][a-z0-9_.-]{0,119}$'),
  value_json jsonb not null check (jsonb_typeof(value_json) in ('string', 'boolean')),
  review_state text not null default 'owner_confirmed' check (review_state = 'owner_confirmed'),
  created_at timestamptz not null default now(),
  row_version integer not null default 0 check (row_version >= 0),
  foreign key (owner_id, document_version_id) references public.document_versions(owner_id, id) on delete cascade
);
create index document_form_field_mappings_owner_inspection_created_idx
  on public.document_form_field_mappings (owner_id, inspection_id, created_at desc);
create index document_form_field_mappings_owner_document_field_created_idx
  on public.document_form_field_mappings (owner_id, document_version_id, field_name, created_at desc);
create trigger document_form_field_mappings_touch before update on public.document_form_field_mappings for each row execute procedure public.touch_mutable_row();
alter table public.document_form_field_mappings enable row level security;
create policy document_form_field_mappings_owner_read on public.document_form_field_mappings for select using (owner_id = auth.uid());
revoke all on public.document_form_field_mappings from public, anon, authenticated;
grant select on public.document_form_field_mappings to authenticated;

create or replace function public.record_document_form_field_mapping(
  p_inspection_id uuid,
  p_field_name text,
  p_profile_fact_version_id uuid
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner_id uuid := auth.uid();
  v_document_version_id uuid;
  v_fields jsonb;
  v_field jsonb;
  v_kind text;
  v_options jsonb;
  v_fact_key text;
  v_value_json jsonb;
  v_mapping_id uuid;
begin
  if v_owner_id is null then raise exception 'FORM_MAPPING_AUTH_REQUIRED'; end if;
  if trim(p_field_name) = '' then raise exception 'FORM_MAPPING_FIELD_REQUIRED'; end if;
  select inspection.document_version_id, inspection.fields into v_document_version_id, v_fields
  from public.document_form_inspections as inspection
  where inspection.id = p_inspection_id and inspection.owner_id = v_owner_id
    and inspection.state = 'completed' and inspection.form_state = 'fillable'
  for share;
  if not found then raise exception 'FORM_MAPPING_INSPECTION_NOT_AVAILABLE'; end if;
  select candidate.value into v_field
  from jsonb_array_elements(v_fields) as candidate(value)
  where candidate.value->>'name' = trim(p_field_name)
  limit 1;
  if v_field is null then raise exception 'FORM_MAPPING_FIELD_NOT_INSPECTED'; end if;
  v_kind := v_field->>'kind';
  v_options := coalesce(v_field->'options', '[]'::jsonb);
  if v_kind not in ('text', 'checkbox', 'dropdown', 'option_list', 'radio') then raise exception 'FORM_MAPPING_FIELD_UNSUPPORTED'; end if;
  if v_kind in ('dropdown', 'option_list', 'radio') and not (v_field ? 'options') then
    raise exception 'FORM_MAPPING_FIELD_OPTIONS_UNAVAILABLE';
  end if;

  select fact.fact_key, fact.value_json into v_fact_key, v_value_json
  from public.profile_fact_versions as fact
  where fact.id = p_profile_fact_version_id and fact.owner_id = v_owner_id and fact.confirmation_state = 'owner_confirmed'
  for share;
  if not found then raise exception 'FORM_MAPPING_FACT_NOT_AVAILABLE'; end if;
  if (v_kind = 'checkbox' and jsonb_typeof(v_value_json) <> 'boolean')
    or (v_kind <> 'checkbox' and jsonb_typeof(v_value_json) <> 'string') then
    raise exception 'FORM_MAPPING_VALUE_TYPE_MISMATCH';
  end if;
  if v_kind in ('dropdown', 'option_list', 'radio') and jsonb_array_length(v_options) > 0
    and not exists (select 1 from jsonb_array_elements_text(v_options) as option_value where option_value = v_value_json #>> '{}') then
    raise exception 'FORM_MAPPING_VALUE_NOT_IN_OPTIONS';
  end if;
  insert into public.document_form_field_mappings (
    owner_id, inspection_id, document_version_id, field_name, profile_fact_version_id, fact_key, value_json
  ) values (
    v_owner_id, p_inspection_id, v_document_version_id, trim(p_field_name), p_profile_fact_version_id, v_fact_key, v_value_json
  ) returning id into v_mapping_id;
  return v_mapping_id;
end;
$$;
revoke all on function public.record_document_form_field_mapping(uuid, text, uuid) from public, anon;
grant execute on function public.record_document_form_field_mapping(uuid, text, uuid) to authenticated;

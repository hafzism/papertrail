-- Owner-supplied AI credentials are encrypted by the trusted web server before
-- reaching this table. The ciphertext is never readable through the client API.
create table public.owner_ai_provider_credentials (
  owner_id uuid primary key references public.profiles(user_id) on delete cascade,
  provider text not null check (provider in ('openai', 'gemini')),
  model text not null check (model ~ '^[A-Za-z0-9._-]{1,120}$'),
  key_ciphertext text not null check (char_length(key_ciphertext) between 40 and 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.owner_ai_provider_credentials enable row level security;

-- There is intentionally no table policy and no client table grant. Owner-facing
-- functions expose metadata only; a trusted worker function exposes ciphertext
-- only to the service role.

create or replace function public.save_owner_ai_provider_credential(
  p_provider text,
  p_model text,
  p_key_ciphertext text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_provider not in ('openai', 'gemini') then raise exception 'AI_PROVIDER_INVALID'; end if;
  if p_model !~ '^[A-Za-z0-9._-]{1,120}$' then raise exception 'AI_MODEL_INVALID'; end if;
  if char_length(p_key_ciphertext) not between 40 and 8192 then raise exception 'AI_CREDENTIAL_INVALID'; end if;

  insert into public.owner_ai_provider_credentials (owner_id, provider, model, key_ciphertext)
  values (auth.uid(), p_provider, p_model, p_key_ciphertext)
  on conflict (owner_id) do update set
    provider = excluded.provider,
    model = excluded.model,
    key_ciphertext = excluded.key_ciphertext,
    updated_at = now();
end;
$$;

create or replace function public.remove_owner_ai_provider_credential()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  delete from public.owner_ai_provider_credentials where owner_id = auth.uid();
end;
$$;

create or replace function public.owner_ai_provider_credential_status()
returns table(provider text, model text, updated_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return query select c.provider, c.model, c.updated_at
    from public.owner_ai_provider_credentials c
    where c.owner_id = auth.uid();
end;
$$;

create or replace function public.get_owner_ai_provider_credential_for_service(p_owner_id uuid)
returns table(provider text, model text, key_ciphertext text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query select c.provider, c.model, c.key_ciphertext
    from public.owner_ai_provider_credentials c
    where c.owner_id = p_owner_id;
end;
$$;

revoke all on table public.owner_ai_provider_credentials from public, anon, authenticated;
revoke all on function public.save_owner_ai_provider_credential(text, text, text) from public, anon;
revoke all on function public.remove_owner_ai_provider_credential() from public, anon;
revoke all on function public.owner_ai_provider_credential_status() from public, anon;
revoke all on function public.get_owner_ai_provider_credential_for_service(uuid) from public, anon, authenticated;
grant execute on function public.save_owner_ai_provider_credential(text, text, text) to authenticated;
grant execute on function public.remove_owner_ai_provider_credential() to authenticated;
grant execute on function public.owner_ai_provider_credential_status() to authenticated;
-- `service_role` serves trusted Next.js routes; `postgres` is the direct trusted
-- worker connection used by this repository. Neither role is available to users.
grant execute on function public.get_owner_ai_provider_credential_for_service(uuid) to service_role, postgres;

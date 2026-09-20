-- Every actionable update stays in the in-app inbox. Telegram is a separate,
-- bounded delivery attempt with its own state and never becomes the source of
-- truth for whether an owner has seen or acted on a notification.
create table public.telegram_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  telegram_chat_id bigint not null,
  state text not null default 'queued' check (state in ('queued', 'sending', 'sent', 'failed', 'uncertain', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 3),
  provider_message_id text,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 0 check (row_version >= 0),
  unique (notification_id)
);
create index telegram_notification_deliveries_owner_created_idx on public.telegram_notification_deliveries (owner_id, created_at desc);
create trigger telegram_notification_deliveries_touch before update on public.telegram_notification_deliveries for each row execute procedure public.touch_mutable_row();
alter table public.telegram_notification_deliveries enable row level security;
create policy telegram_notification_deliveries_owner_read on public.telegram_notification_deliveries for select using (owner_id = auth.uid());
revoke all on public.telegram_notification_deliveries from public, anon, authenticated;
grant select on public.telegram_notification_deliveries to authenticated;

create or replace function public.enqueue_telegram_notification_delivery(p_notification_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_notification public.notifications%rowtype; v_chat_id bigint; v_delivery_id uuid;
begin
  select * into v_notification from public.notifications where id = p_notification_id;
  if not found then return; end if;
  select telegram_chat_id into v_chat_id from public.telegram_channel_links where owner_id = v_notification.owner_id and unlinked_at is null;
  if v_chat_id is null then return; end if;
  insert into public.telegram_notification_deliveries (owner_id, notification_id, telegram_chat_id)
    values (v_notification.owner_id, v_notification.id, v_chat_id)
    on conflict (notification_id) do nothing returning id into v_delivery_id;
  if v_delivery_id is null then return; end if;
  insert into public.jobs (kind, owner_id, dedupe_key, payload)
    values ('deliver_telegram_notification', v_notification.owner_id, 'telegram-delivery:' || v_delivery_id::text, jsonb_build_object('deliveryId', v_delivery_id, 'notificationId', v_notification.id));
  insert into public.outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
    values ('telegram_notification_queued', 'telegram_notification_delivery', v_delivery_id, jsonb_build_object('deliveryId', v_delivery_id, 'notificationId', v_notification.id), 'telegram-delivery:' || v_delivery_id::text);
end;
$$;

create or replace function public.enqueue_telegram_delivery_after_notification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.enqueue_telegram_notification_delivery(new.id);
  return new;
end;
$$;
create trigger notifications_enqueue_telegram_delivery after insert on public.notifications for each row execute procedure public.enqueue_telegram_delivery_after_notification();

create or replace function public.begin_telegram_notification_delivery(
  p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_delivery_id uuid
) returns table (telegram_chat_id bigint, deep_link text) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
    update public.telegram_notification_deliveries as delivery
      set state = 'sending', attempts = attempts + 1, last_error_code = null
      from public.notifications as notification, public.jobs as job, public.telegram_channel_links as channel
      where delivery.id = p_delivery_id and delivery.owner_id = p_owner_id and delivery.notification_id = notification.id
        and job.id = p_job_id and job.owner_id = p_owner_id and job.kind = 'deliver_telegram_notification'
        and job.state = 'running' and job.fencing_token = p_fencing_token and job.lease_expires_at > now()
        and channel.owner_id = p_owner_id and channel.telegram_chat_id = delivery.telegram_chat_id and channel.unlinked_at is null
        and delivery.state = 'queued'
      returning delivery.telegram_chat_id, notification.deep_link;
end;
$$;

create or replace function public.record_telegram_notification_delivery(
  p_job_id uuid, p_fencing_token bigint, p_owner_id uuid, p_delivery_id uuid,
  p_state text, p_provider_message_id text default null, p_error_code text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_state not in ('sent', 'failed', 'uncertain') then raise exception 'TELEGRAM_DELIVERY_STATE_INVALID'; end if;
  update public.telegram_notification_deliveries as delivery
    set state = p_state, provider_message_id = nullif(left(coalesce(p_provider_message_id, ''), 120), ''),
      last_error_code = nullif(left(coalesce(p_error_code, ''), 160), ''),
      sent_at = case when p_state = 'sent' then now() else null end
    from public.jobs as job
    where delivery.id = p_delivery_id and delivery.owner_id = p_owner_id
      and job.id = p_job_id and job.owner_id = p_owner_id and job.kind = 'deliver_telegram_notification'
      and job.state = 'running' and job.fencing_token = p_fencing_token and job.lease_expires_at > now()
      and delivery.state = 'sending';
  return found;
end;
$$;

revoke all on function public.enqueue_telegram_notification_delivery(uuid) from public, anon, authenticated;
revoke all on function public.begin_telegram_notification_delivery(uuid, bigint, uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_telegram_notification_delivery(uuid, bigint, uuid, uuid, text, text, text) from public, anon, authenticated;

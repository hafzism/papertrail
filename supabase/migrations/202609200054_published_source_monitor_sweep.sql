-- The worker invokes this bounded sweep periodically. Only sources a moderator
-- has explicitly enabled are due, and an existing queued/running job prevents
-- duplicate work. The function never enables a source or publishes a revision.
create or replace function public.enqueue_due_published_source_checks(
  p_interval_minutes integer default 60,
  p_limit integer default 20
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source record; v_count integer := 0; v_job_id uuid;
begin
  if p_interval_minutes not between 1 and 10080 then raise exception 'PUBLISHED_SOURCE_INTERVAL_INVALID'; end if;
  if p_limit not between 1 and 100 then raise exception 'PUBLISHED_SOURCE_LIMIT_INVALID'; end if;
  for v_source in
    select source.id from public.published_program_sources as source
      where source.monitoring_enabled
        and (source.last_checked_at is null or source.last_checked_at <= now() - make_interval(mins => p_interval_minutes))
        and not exists (
          select 1 from public.jobs as job where job.kind = 'monitor_published_source'
            and job.public_scope = 'published-source:' || source.id::text and job.state in ('queued', 'running')
        )
      order by coalesce(source.last_checked_at, source.published_at) asc
      limit p_limit
      for update skip locked
  loop
    insert into public.jobs (kind, public_scope, dedupe_key, payload)
      values ('monitor_published_source', 'published-source:' || v_source.id::text,
        'published-source-sweep:' || v_source.id::text || ':' || floor(extract(epoch from now()) / 60)::text,
        jsonb_build_object('sourceId', v_source.id, 'requestedBy', null)) returning id into v_job_id;
    insert into public.outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      values ('published_source_check_queued', 'published_program_source', v_source.id,
        jsonb_build_object('sourceId', v_source.id, 'jobId', v_job_id, 'trigger', 'scheduled'), 'published-source-check:' || v_job_id::text);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.enqueue_due_published_source_checks(integer, integer) from public, anon, authenticated;

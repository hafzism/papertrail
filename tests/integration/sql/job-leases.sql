do $$
declare
  first_claim record;
  second_claim record;
  extraction_input record;
begin
  select * into first_claim from public.claim_next_job(90);
  if first_claim.id <> '80000000-0000-4000-8000-000000000001'::uuid or first_claim.fencing_token <> 1 then
    raise exception 'A16/A42 failed: first lease did not claim the expected job with fence 1';
  end if;
  select * into second_claim from public.claim_next_job(90);
  if second_claim.id is not null then
    raise exception 'A16 failed: duplicate delivery claimed an already leased job';
  end if;
  if not public.heartbeat_job(first_claim.id, first_claim.fencing_token, 90) then
    raise exception 'A42 failed: current fence cannot heartbeat';
  end if;
  select * into extraction_input from public.begin_document_extraction(
    first_claim.id,
    first_claim.fencing_token,
    first_claim.owner_id,
    '30000000-0000-4000-8000-0000000000a1',
    0
  );
  if extraction_input.object_path <> 'owner-a/certificate.pdf' or extraction_input.mime_type <> 'application/pdf' then
    raise exception 'document extraction did not receive the fenced owner-scoped input';
  end if;
  if not public.record_document_extraction(
    first_claim.id,
    first_claim.fencing_token,
    first_claim.owner_id,
    '30000000-0000-4000-8000-0000000000a1',
    0,
    'integration-pdftotext',
    'completed',
    'extractions/30000000-0000-4000-8000-0000000000a1/integration.txt',
    'Extracted fixture text',
    1,
    '[]'::jsonb,
    '{"parser":"integration"}'::jsonb
  ) then
    raise exception 'fenced worker could not persist document extraction';
  end if;
  if not exists (select 1 from public.document_extractions where document_version_id = '30000000-0000-4000-8000-0000000000a1' and text_excerpt = 'Extracted fixture text') then
    raise exception 'document extraction result was not persisted';
  end if;
  if public.finish_job(first_claim.id, first_claim.fencing_token + 1, 'succeeded') then
    raise exception 'A18/A42 failed: stale fence completed the job';
  end if;
  if not public.finish_job(first_claim.id, first_claim.fencing_token, 'succeeded') then
    raise exception 'A42 failed: current fence could not complete job';
  end if;
end;
$$;

do $$
declare
  reclaimed record;
begin
  insert into public.jobs (id, kind, owner_id, dedupe_key, payload, state, fencing_token, lease_expires_at)
  values (
    '80000000-0000-4000-8000-000000000002',
    'cleanup',
    '00000000-0000-4000-8000-0000000000a1',
    'expired-cleanup-job',
    '{}'::jsonb,
    'running',
    7,
    now() - interval '1 second'
  );
  select * into reclaimed from public.claim_next_job(90);
  if reclaimed.id <> '80000000-0000-4000-8000-000000000002'::uuid or reclaimed.fencing_token <> 8 then
    raise exception 'A42 failed: an expired lease was not reclaimed under a newer fence';
  end if;
  if public.finish_job(reclaimed.id, 7, 'succeeded') then
    raise exception 'A42 failed: expired worker completed a reclaimed job';
  end if;
end;
$$;

select public.record_worker_heartbeat('integration-worker', '["database"]'::jsonb, null);

do $$
begin
  if (select capabilities from public.worker_heartbeats where worker_id = 'integration-worker') <> '["database"]'::jsonb then
    raise exception 'worker heartbeat did not retain declared capabilities';
  end if;
end;
$$;

insert into public.jobs (id, kind, owner_id, dedupe_key, payload)
values (
  '80000000-0000-4000-8000-000000000003',
  'extract_document',
  '00000000-0000-4000-8000-0000000000a1',
  'unimplemented-extract-job',
  '{}'::jsonb
);

do $$
declare
  unsupported_claim record;
  supported_claim record;
begin
  select * into unsupported_claim from public.claim_next_supported_job(90, array['cleanup']);
  if unsupported_claim.id is not null then
    raise exception 'worker claimed a job outside its declared supported kinds';
  end if;
  select * into supported_claim from public.claim_next_supported_job(90, array['extract_document']);
  if supported_claim.id <> '80000000-0000-4000-8000-000000000003'::uuid then
    raise exception 'worker did not claim a declared supported kind';
  end if;
end;
$$;

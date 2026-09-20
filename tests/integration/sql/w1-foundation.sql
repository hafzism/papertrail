begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);

do $$
declare
  v_profile_fact_id uuid;
  v_application_fact_override_id uuid;
begin
  if (select count(*) from public.applications) <> 1 then
    raise exception 'A01 failed: owner A can see another application';
  end if;
  if exists (select 1 from public.applications where id = '10000000-0000-4000-8000-0000000000b2') then
    raise exception 'A01 failed: guessed B application ID is visible';
  end if;
  if (select count(*) from public.document_versions where sha256 = repeat('a', 64)) <> 1 then
    raise exception 'A04 failed: same bytes leak another owner document';
  end if;
  if (select count(*) from public.tracked_activities where confirmation_state = 'candidate') <> 1 then
    raise exception 'D12 failed: owner cannot see their candidate activity';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'private-documents') <> 2 then
    raise exception 'A01/A04 failed: owner A can enumerate B storage object';
  end if;
  begin
    update public.tracked_activities set tracking_state = 'active' where id = '70000000-0000-4000-8000-0000000000a1';
    raise exception 'D12 failed: client directly activated monitoring';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
      values ('private-documents', 'forged-owner.pdf', '00000000-0000-4000-8000-0000000000b2');
    raise exception 'A01 failed: owner A wrote a storage object for owner B';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.documents (owner_id, label) values (auth.uid(), 'forged direct document');
    raise exception 'authoritative document creation must not be direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.profile_fact_versions (owner_id, fact_key, value_json, source_kind, confirmation_state, confirmed_at)
    values (auth.uid(), 'forged.fact', 'true'::jsonb, 'owner_assertion', 'owner_confirmed', now());
    raise exception 'profile facts must not be direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  v_profile_fact_id := public.record_owner_profile_fact('applicant_type', '"student"'::jsonb);
  if not exists (
    select 1 from public.profile_fact_versions
    where id = v_profile_fact_id
      and owner_id = auth.uid() and confirmation_state = 'owner_confirmed' and source_kind = 'owner_assertion'
  ) then
    raise exception 'owner profile fact was not recorded as confirmed owner assertion';
  end if;
  begin
    insert into public.application_fact_overrides (owner_id, application_id, fact_key, value_json, source_kind, confirmed_at)
    values (auth.uid(), '10000000-0000-4000-8000-0000000000a1', 'forged.fact', 'true'::jsonb, 'owner_assertion', now());
    raise exception 'application fact overrides must not be direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  v_application_fact_override_id := public.record_application_fact_override(
    '10000000-0000-4000-8000-0000000000a1',
    'applicant_type',
    '"alumni"'::jsonb
  );
  if not exists (
    select 1 from public.application_fact_overrides
    where id = v_application_fact_override_id
      and owner_id = auth.uid() and fact_key = 'applicant_type'
  ) then
    raise exception 'owner application fact override was not recorded';
  end if;
  begin
    update public.applications set lifecycle_state = 'submitted_unconfirmed' where id = '10000000-0000-4000-8000-0000000000a1';
    raise exception 'authoritative application transition must not be direct client DML';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
rollback;

do $$
begin
  if public.is_valid_requirement_predicate('{"op":"all","args":[]}'::jsonb) then
    raise exception 'empty requirement predicate was accepted';
  end if;
  if public.is_valid_requirement_predicate('{"op":"exists","path":"owner_id"}'::jsonb) then
    raise exception 'unallowlisted requirement path was accepted';
  end if;
  if not public.is_valid_requirement_predicate('{"op":"manual_review","reason":"Needs owner review."}'::jsonb) then
    raise exception 'valid manual review predicate was rejected';
  end if;
end;
$$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_document_paths text[];
  v_artifact_paths text[];
begin
  begin
    update public.documents set deleted_at = now() where id = '20000000-0000-4000-8000-0000000000a1';
    raise exception 'private document removal must not be direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  select document_object_paths, artifact_object_paths into v_document_paths, v_artifact_paths
  from public.remove_private_document('20000000-0000-4000-8000-0000000000a1');
  if v_document_paths <> array['owner-a/certificate.pdf']::text[] or cardinality(v_artifact_paths) <> 0 then
    raise exception 'private document removal did not return bounded owner cleanup paths';
  end if;
  if exists (select 1 from public.documents where id = '20000000-0000-4000-8000-0000000000a1') then
    raise exception 'removed private document remains visible to its owner';
  end if;
  if exists (select 1 from public.document_versions where id = '30000000-0000-4000-8000-0000000000a1') then
    raise exception 'removed private document version remains visible to its owner';
  end if;
end;
$$;
rollback;

begin;
update public.document_versions set extraction_state = 'needs_input'
  where id = '30000000-0000-4000-8000-0000000000a1';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare v_job_id uuid;
begin
  v_job_id := public.retry_document_extraction('30000000-0000-4000-8000-0000000000a1');
  if not exists (select 1 from public.document_versions where id = '30000000-0000-4000-8000-0000000000a1' and extraction_state = 'pending') then
    raise exception 'owner retry did not requeue the document version';
  end if;
  reset role;
  if not exists (select 1 from public.jobs where id = v_job_id and kind = 'extract_document' and payload->>'reason' = 'owner_requested_retry') then
    raise exception 'owner retry did not create its own extraction job';
  end if;
  if not exists (select 1 from public.outbox where aggregate_id = '30000000-0000-4000-8000-0000000000a1' and event_type = 'document_extraction_retry_requested') then
    raise exception 'owner retry did not write an outbox event';
  end if;
end;
$$;
rollback;

begin;
update public.document_versions set extraction_state = 'completed'
  where id = '30000000-0000-4000-8000-0000000000a1';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_snapshot_id uuid;
  v_requirement_id uuid;
  v_binding_id uuid;
begin
  v_snapshot_id := public.add_application_text_description(
    '10000000-0000-4000-8000-0000000000a1', 'Evidence binding test source.'
  );
  v_requirement_id := public.add_private_requirement_draft(
    '10000000-0000-4000-8000-0000000000a1', v_snapshot_id, 'application.evidence_test',
    'document', 'Evidence test requirement', 'Evidence binding test excerpt.'
  );
  v_binding_id := public.add_evidence_binding_draft(
    '10000000-0000-4000-8000-0000000000a1', v_requirement_id,
    '30000000-0000-4000-8000-0000000000a1', 'Owner proposes this completed document for review.'
  );
  if not exists (select 1 from public.evidence_bindings where id = v_binding_id and owner_id = auth.uid() and binding_state = 'proposed') then
    raise exception 'evidence binding was not owner-scoped and proposed';
  end if;
  if not public.confirm_evidence_binding(v_binding_id) then
    raise exception 'evidence binding owner confirmation did not report success';
  end if;
  if not exists (select 1 from public.evidence_bindings where id = v_binding_id and binding_state = 'confirmed' and confirmed_by = auth.uid()) then
    raise exception 'evidence binding owner confirmation did not retain owner confirmation';
  end if;
end;
$$;
rollback;

-- W3: packet manifests are fenced private artifacts, always review-only, and their
-- derived bytes are included if an owner removes one of the bound documents.
begin;
update public.document_versions set extraction_state = 'completed'
  where id = '30000000-0000-4000-8000-0000000000a1';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_snapshot_id uuid;
  v_requirement_id uuid;
  v_binding_id uuid;
  v_run_id uuid;
  v_job_id uuid;
begin
  v_snapshot_id := public.add_application_text_description(
    '10000000-0000-4000-8000-0000000000a1', 'Attach the certificate to the application.'
  );
  v_requirement_id := public.add_private_requirement_draft(
    '10000000-0000-4000-8000-0000000000a1', v_snapshot_id, 'application.packet_certificate',
    'document', 'Certificate', 'Attach the certificate to the application.'
  );
  v_binding_id := public.add_evidence_binding_draft(
    '10000000-0000-4000-8000-0000000000a1', v_requirement_id,
    '30000000-0000-4000-8000-0000000000a1', 'Owner confirmed this document for the packet manifest.'
  );
  perform public.confirm_evidence_binding(v_binding_id);
  begin
    insert into public.artifacts (owner_id, application_id, kind, object_path, sha256, input_version_vector)
    values (auth.uid(), '10000000-0000-4000-8000-0000000000a1', 'packet_manifest', 'forged/manifest.json', repeat('a', 64), '{}'::jsonb);
    raise exception 'packet artifacts must not allow direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  select artifact_run_id, job_id into v_run_id, v_job_id
  from public.request_private_packet_manifest('10000000-0000-4000-8000-0000000000a1');
  if v_run_id is null or v_job_id is null then raise exception 'packet manifest request did not return fenced IDs'; end if;
  if not exists (
    select 1 from public.artifact_generation_runs
    where id = v_run_id and owner_id = auth.uid() and state = 'queued'
  ) then raise exception 'packet manifest request was not owner-scoped and queued'; end if;
  perform set_config('papertrail.test_packet_run', v_run_id::text, true);
  perform set_config('papertrail.test_packet_job', v_job_id::text, true);
end;
$$;
reset role;
do $$
declare
  v_run_id uuid := current_setting('papertrail.test_packet_run')::uuid;
  v_job_id uuid := current_setting('papertrail.test_packet_job')::uuid;
  v_requirement_edge record;
  v_impact record;
  v_artifact_id uuid;
  v_work record;
begin
  if not exists (select 1 from public.jobs where id = v_job_id and kind = 'prepare_packet_manifest') then
    raise exception 'packet manifest request did not queue the worker-safe job';
  end if;
  update public.jobs set state = 'running', fencing_token = 1, lease_expires_at = now() + interval '90 seconds'
    where id = v_job_id;
  select * into v_work from public.begin_private_packet_manifest(
    v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_run_id, 0
  );
  if v_work.state <> 'ready' or v_work.manifest_input->>'manifestVersion' <> 'packet-manifest-v1'
    or (v_work.manifest_input->>'submissionReady')::boolean <> false then
    raise exception 'packet manifest worker input did not remain explicitly review-only';
  end if;
  if not public.record_private_packet_manifest(
    v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_run_id, 0,
    'packet-manifests/integration/manifest.json', repeat('c', 64), v_work.input_version_vector
  ) then raise exception 'fenced packet manifest worker could not record output'; end if;
  if not exists (
    select 1 from public.artifacts
    where owner_id = '00000000-0000-4000-8000-0000000000a1'
      and object_path = 'packet-manifests/integration/manifest.json'
      and status = 'needs_review' and render_check_status = 'not_applicable'
  ) then raise exception 'packet manifest artifact was not recorded as review-only'; end if;
  if not exists (
    select 1 from public.dependency_edges
    where owner_id = '00000000-0000-4000-8000-0000000000a1'
      and application_id = '10000000-0000-4000-8000-0000000000a1'
      and from_type = 'private_requirement' and to_type = 'artifact'
      and relation = 'included_in_packet_manifest'
  ) then raise exception 'packet manifest did not record reverse requirement dependency'; end if;
  select from_id, from_version into v_requirement_edge
  from public.dependency_edges
  where owner_id = '00000000-0000-4000-8000-0000000000a1'
    and application_id = '10000000-0000-4000-8000-0000000000a1'
    and from_type = 'private_requirement' and to_type = 'artifact'
  limit 1;
  select id into v_artifact_id from public.artifacts
  where object_path = 'packet-manifests/integration/manifest.json';
  select * into v_impact from public.apply_private_dependency_impact(
    '10000000-0000-4000-8000-0000000000a1', 'private_requirement', v_requirement_edge.from_id,
    v_requirement_edge.from_version, 'Integration test changes this one private requirement.'
  );
  if not (v_artifact_id = any(v_impact.affected_artifact_ids)) then
    raise exception 'targeted dependency impact did not return the dependent packet artifact';
  end if;
  if not exists (
    select 1 from public.artifacts
    where object_path = 'packet-manifests/integration/manifest.json' and status = 'stale'
  ) then raise exception 'targeted dependency impact did not stale only its dependent artifact'; end if;
end;
$$;
-- Worker-created private artifacts are uploaded with the service role, so their
-- storage owner_id is null. Browser reads must instead be bound to the matching
-- owner-scoped artifact record (and must not leak to another owner).
insert into storage.objects (bucket_id, name, owner_id)
values ('private-artifacts', 'packet-manifests/integration/manifest.json', null);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
begin
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'private-artifacts' and name = 'packet-manifests/integration/manifest.json'
  ) then
    raise exception 'owner cannot read their service-created private artifact';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
do $$
begin
  if exists (select 1 from public.artifacts where object_path = 'packet-manifests/integration/manifest.json') then
    raise exception 'A01 failed: owner B can read owner A packet manifest';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'private-artifacts' and name = 'packet-manifests/integration/manifest.json'
  ) then
    raise exception 'A01 failed: owner B can read owner A private artifact bytes';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare v_document_paths text[]; v_artifact_paths text[];
begin
  select document_object_paths, artifact_object_paths into v_document_paths, v_artifact_paths
  from public.remove_private_document('20000000-0000-4000-8000-0000000000a1');
  if not ('packet-manifests/integration/manifest.json' = any(v_artifact_paths)) then
    raise exception 'packet manifest derivative was not returned for document removal';
  end if;
  if not exists (select 1 from public.artifacts where object_path = 'packet-manifests/integration/manifest.json' and status = 'stale') then
    raise exception 'document removal did not stale the dependent packet manifest';
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_snapshot_id uuid;
  v_proposal_run_id uuid;
  v_job_id uuid;
begin
  v_snapshot_id := public.add_application_text_description(
    '10000000-0000-4000-8000-0000000000a1',
    'Applicants must upload a passport-size photograph before 30 June 2027.'
  );
  begin
    insert into public.private_requirement_proposal_runs (
      owner_id, application_id, private_snapshot_id, source_content_sha256, prompt_version
    ) values (
      auth.uid(), '10000000-0000-4000-8000-0000000000a1', v_snapshot_id, repeat('a', 64), 'forged'
    );
    raise exception 'private requirement proposal runs must not allow direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.private_requirement_proposals (
      run_id, owner_id, application_id, private_snapshot_id, ordinal, logical_key, kind, label,
      citation_excerpt, citation_source_hash, citation_basis
    ) values (
      gen_random_uuid(), auth.uid(), '10000000-0000-4000-8000-0000000000a1', v_snapshot_id, 1,
      'forged.requirement', 'document', 'Forged requirement', 'Forged citation', repeat('a', 64), 'owner_text'
    );
    raise exception 'private requirement proposals must not allow direct client DML';
  exception when insufficient_privilege then
    null;
  end;

  select proposal_run_id, job_id into v_proposal_run_id, v_job_id
  from public.request_private_requirement_proposal('10000000-0000-4000-8000-0000000000a1', v_snapshot_id);
  if v_proposal_run_id is null or v_job_id is null then
    raise exception 'private requirement proposal request did not return run and job IDs';
  end if;
  if not exists (
    select 1 from public.private_requirement_proposal_runs
    where id = v_proposal_run_id and owner_id = auth.uid() and state = 'queued'
      and private_snapshot_id = v_snapshot_id and source_content_sha256 = encode(digest('Applicants must upload a passport-size photograph before 30 June 2027.', 'sha256'), 'hex')
  ) then
    raise exception 'private requirement proposal request did not retain the immutable text source';
  end if;
  perform set_config('papertrail.test_proposal_snapshot', v_snapshot_id::text, true);
  perform set_config('papertrail.test_proposal_run', v_proposal_run_id::text, true);
  perform set_config('papertrail.test_proposal_job', v_job_id::text, true);
end;
$$;
reset role;
do $$
declare
  v_snapshot_id uuid := current_setting('papertrail.test_proposal_snapshot')::uuid;
  v_proposal_run_id uuid := current_setting('papertrail.test_proposal_run')::uuid;
  v_job_id uuid := current_setting('papertrail.test_proposal_job')::uuid;
  v_source_text text;
begin
  if not exists (
    select 1 from public.jobs
    where id = v_job_id and kind = 'propose_private_requirements'
      and payload->>'proposalRunId' = v_proposal_run_id::text
  ) then
    raise exception 'private requirement proposal request did not queue a scoped worker job';
  end if;
  if not exists (
    select 1 from public.outbox
    where aggregate_id = v_proposal_run_id and event_type = 'private_requirement_proposal_queued'
  ) then
    raise exception 'private requirement proposal request did not write its outbox event';
  end if;
  update public.jobs
  set state = 'running', fencing_token = 1, lease_expires_at = now() + interval '90 seconds'
  where id = v_job_id;

  select source_text into v_source_text
  from public.begin_private_requirement_proposal(
    v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_proposal_run_id, 0
  );
  if v_source_text <> 'Applicants must upload a passport-size photograph before 30 June 2027.' then
    raise exception 'trusted worker did not receive the exact immutable proposal source';
  end if;
  if not public.record_private_requirement_proposal(
    v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_proposal_run_id, 0,
    'completed', 'gpt-5.6-luna', 'resp_test_requirement_proposal',
    jsonb_build_array(jsonb_build_object(
      'logicalKey', 'application.photograph',
      'kind', 'document',
      'label', 'Upload a passport-size photograph.',
      'citationExcerpt', 'Applicants must upload a passport-size photograph',
      'ambiguityFlags', jsonb_build_array('Photo dimensions are not stated.')
    )),
    null
  ) then
    raise exception 'trusted worker could not record a fenced requirement proposal result';
  end if;
  if not exists (
    select 1 from public.private_requirement_proposals
    where run_id = v_proposal_run_id and review_state = 'proposed'
      and citation_basis = 'owner_text'
      and predicate_json->>'op' = 'manual_review'
      and applicability_json->>'op' = 'manual_review'
  ) then
    raise exception 'worker proposal did not retain manual-review defaults and owner-text provenance';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_proposal_id uuid;
  v_requirement_id uuid;
begin
  select id into v_proposal_id
  from public.private_requirement_proposals
  where run_id = current_setting('papertrail.test_proposal_run')::uuid;
  v_requirement_id := public.accept_private_requirement_proposal(v_proposal_id);
  if not exists (
    select 1 from public.private_requirement_versions
    where id = v_requirement_id and owner_id = auth.uid()
      and citation_basis = 'owner_text'
      and citation_excerpt = 'Applicants must upload a passport-size photograph'
      and review_state = 'unresolved'
      and predicate_json->>'op' = 'manual_review'
      and applicability_json->>'op' = 'manual_review'
      and ambiguity_flags = jsonb_build_array('Photo dimensions are not stated.')
  ) then
    raise exception 'accepting a proposal did not preserve citation/provenance/manual-review requirements';
  end if;
  if not exists (
    select 1 from public.private_requirement_proposals
    where id = v_proposal_id and review_state = 'accepted' and accepted_requirement_id = v_requirement_id
  ) then
    raise exception 'accepted proposal was not marked with its resulting requirement';
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_application_id uuid;
begin
  v_application_id := public.create_application_draft('New source pending');
  if not exists (select 1 from public.applications where id = v_application_id and owner_id = auth.uid() and lifecycle_state = 'draft') then
    raise exception 'application draft creation did not create the owner-scoped draft';
  end if;
  if not exists (select 1 from public.application_events where application_id = v_application_id and sequence = 1 and event_type = 'application_draft_created') then
    raise exception 'application draft creation did not record its initial event';
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_snapshot_id uuid;
  v_requirement_id uuid;
begin
  begin
    insert into public.private_notice_snapshots (owner_id, application_id, source_kind, source_status, captured_text, content_sha256)
    values (auth.uid(), '10000000-0000-4000-8000-0000000000a1', 'text_description', 'unresolved', 'forged direct source', repeat('a', 64));
    raise exception 'authoritative application source creation must not be direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  v_snapshot_id := public.add_application_text_description(
    '10000000-0000-4000-8000-0000000000a1', 'A private description without a source link.'
  );
  if not exists (
    select 1 from public.private_notice_snapshots
    where id = v_snapshot_id and owner_id = auth.uid() and source_status = 'unresolved'
  ) then
    raise exception 'text description did not create an owner-scoped unresolved snapshot';
  end if;
  if not exists (
    select 1 from public.application_events
    where application_id = '10000000-0000-4000-8000-0000000000a1'
      and event_type = 'application_text_description_added'
  ) then
    raise exception 'text description did not record an application event';
  end if;
  v_snapshot_id := public.add_application_public_url_source(
    '10000000-0000-4000-8000-0000000000a1', 'https://example.test/notices/2026'
  );
  if not exists (
    select 1 from public.private_notice_snapshots
    where id = v_snapshot_id and owner_id = auth.uid() and source_status = 'pending_capture'
      and source_url = 'https://example.test/notices/2026'
  ) then
    raise exception 'public URL did not create an owner-scoped pending-capture snapshot';
  end if;
  begin
    perform public.add_application_public_url_source(
      '10000000-0000-4000-8000-0000000000a1', 'https://127.0.0.1/private'
    );
    raise exception 'private-network URL was accepted as a source candidate';
  exception when raise_exception then
    if sqlerrm <> 'APPLICATION_SOURCE_DISALLOWED_HOST' then raise; end if;
  end;
  begin
    insert into public.private_requirement_versions (owner_id, application_id, private_snapshot_id, logical_key, kind, label, citation_excerpt)
    values (auth.uid(), '10000000-0000-4000-8000-0000000000a1', v_snapshot_id, 'forged.requirement', 'document', 'Forged requirement', 'Forged citation');
    raise exception 'private requirement creation must not be direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  v_requirement_id := public.add_private_requirement_draft(
    '10000000-0000-4000-8000-0000000000a1', v_snapshot_id, 'application.identity_document',
    'document', 'Identity document may be required', 'Owner-recorded source excerpt pending review.'
  );
  if not exists (
    select 1 from public.private_requirement_versions
    where id = v_requirement_id and owner_id = auth.uid() and review_state = 'unresolved'
      and citation_basis = 'registered_url' and citation_source_hash ~ '^[A-Fa-f0-9]{64}$'
      and predicate_json->>'op' = 'manual_review' and applicability_json->>'op' = 'manual_review'
      and ambiguity_flags = '[]'::jsonb
  ) then
    raise exception 'private requirement draft was not owner-scoped and unresolved';
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  intake record;
begin
  select * into intake from public.create_document_intake(
    'Incoming certificate', 'certificate', 'owner-a/intake.pdf', repeat('b', 64), 'incoming.pdf', 'application/pdf', 123
  );
  if intake.document_id is null or intake.document_version_id is null or intake.job_id is null then
    raise exception 'document intake did not return created IDs';
  end if;
  if not exists (select 1 from public.document_versions where id = intake.document_version_id and extraction_state = 'pending') then
    raise exception 'document intake did not create a pending document version';
  end if;
  perform set_config('papertrail.test_intake_version', intake.document_version_id::text, true);
  perform set_config('papertrail.test_intake_job', intake.job_id::text, true);
end;
$$;
reset role;
do $$
declare
  v_document_version_id uuid := current_setting('papertrail.test_intake_version')::uuid;
  v_job_id uuid := current_setting('papertrail.test_intake_job')::uuid;
begin
  if not exists (select 1 from public.jobs where id = v_job_id and kind = 'extract_document') then
    raise exception 'document intake did not queue extraction';
  end if;
  if not exists (select 1 from public.outbox where aggregate_id = v_document_version_id and event_type = 'document_intake_created') then
    raise exception 'document intake did not write its outbox event';
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_inspection_id uuid;
  v_job_id uuid;
begin
  begin
    insert into public.document_form_inspections (owner_id, document_version_id)
    values (auth.uid(), '30000000-0000-4000-8000-0000000000a1');
    raise exception 'form inspections must not allow direct client writes';
  exception when insufficient_privilege then
    null;
  end;
  select inspection_id, job_id into v_inspection_id, v_job_id
  from public.request_document_form_inspection('30000000-0000-4000-8000-0000000000a1');
  if v_inspection_id is null or v_job_id is null then
    raise exception 'form inspection request did not create its private run and job';
  end if;
  perform set_config('papertrail.test_form_inspection_id', v_inspection_id::text, true);
  perform set_config('papertrail.test_form_inspection_job_id', v_job_id::text, true);
end;
$$;
reset role;
do $$
declare
  v_inspection_id uuid := current_setting('papertrail.test_form_inspection_id')::uuid;
  v_job_id uuid := current_setting('papertrail.test_form_inspection_job_id')::uuid;
  v_path text;
begin
  if not exists (select 1 from public.jobs where id = v_job_id and kind = 'inspect_acroform') then
    raise exception 'form inspection request did not create its private job';
  end if;
  update public.jobs set state = 'running', fencing_token = 1, lease_expires_at = now() + interval '90 seconds' where id = v_job_id;
  select object_path into v_path from public.begin_document_form_inspection(
    v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_inspection_id, 0
  );
  if v_path <> 'owner-a/certificate.pdf' then
    raise exception 'trusted worker did not receive the owner-scoped private form path';
  end if;
  if not public.record_document_form_inspection(
    v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_inspection_id, 0,
    'completed', 'fillable', null,
    jsonb_build_array(jsonb_build_object('name', 'applicant.name', 'kind', 'text', 'required', true, 'options', '[]'::jsonb))
  ) then
    raise exception 'trusted worker could not record the fenced form inspection';
  end if;
  if not exists (
    select 1 from public.document_form_inspections
    where id = v_inspection_id and state = 'completed' and form_state = 'fillable'
  ) then
    raise exception 'completed form inspection was not retained';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
do $$
begin
  if exists (select 1 from public.document_form_inspections) then
    raise exception 'form inspections leaked across owners';
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_text_fact_id uuid;
  v_boolean_fact_id uuid;
  v_inspection_id uuid;
  v_job_id uuid;
begin
  v_text_fact_id := public.record_owner_profile_fact('applicant.name', '"Asha Thomas"'::jsonb);
  v_boolean_fact_id := public.record_owner_profile_fact('application.declaration', 'true'::jsonb);
  select inspection_id, job_id into v_inspection_id, v_job_id
  from public.request_document_form_inspection('30000000-0000-4000-8000-0000000000a1');
  perform set_config('papertrail.test_form_mapping_text_fact_id', v_text_fact_id::text, true);
  perform set_config('papertrail.test_form_mapping_boolean_fact_id', v_boolean_fact_id::text, true);
  perform set_config('papertrail.test_form_mapping_inspection_id', v_inspection_id::text, true);
  perform set_config('papertrail.test_form_mapping_job_id', v_job_id::text, true);
end;
$$;
reset role;
do $$
declare
  v_inspection_id uuid := current_setting('papertrail.test_form_mapping_inspection_id')::uuid;
  v_job_id uuid := current_setting('papertrail.test_form_mapping_job_id')::uuid;
begin
  update public.jobs set state = 'running', fencing_token = 1, lease_expires_at = now() + interval '90 seconds' where id = v_job_id;
  perform public.begin_document_form_inspection(v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_inspection_id, 0);
  if not public.record_document_form_inspection(
    v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_inspection_id, 0,
    'completed', 'fillable', null,
    jsonb_build_array(
      jsonb_build_object('name', 'applicant_name', 'kind', 'text', 'required', true, 'options', '[]'::jsonb),
      jsonb_build_object('name', 'declaration', 'kind', 'checkbox', 'required', true, 'options', '[]'::jsonb)
    )
  ) then raise exception 'form mapping fixture could not complete inspection'; end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_mapping_id uuid;
begin
  begin
    insert into public.document_form_field_mappings (owner_id, inspection_id, document_version_id, field_name, profile_fact_version_id, fact_key, value_json)
    values (auth.uid(), current_setting('papertrail.test_form_mapping_inspection_id')::uuid, '30000000-0000-4000-8000-0000000000a1', 'forged', current_setting('papertrail.test_form_mapping_text_fact_id')::uuid, 'applicant.name', '"forged"'::jsonb);
    raise exception 'form mappings must not allow direct client writes';
  exception when insufficient_privilege then
    null;
  end;
  v_mapping_id := public.record_document_form_field_mapping(
    current_setting('papertrail.test_form_mapping_inspection_id')::uuid,
    'applicant_name', current_setting('papertrail.test_form_mapping_text_fact_id')::uuid
  );
  if not exists (
    select 1 from public.document_form_field_mappings
    where id = v_mapping_id and fact_key = 'applicant.name' and value_json = '"Asha Thomas"'::jsonb and review_state = 'owner_confirmed'
  ) then raise exception 'owner-confirmed mapping did not retain a fact snapshot'; end if;
  begin
    perform public.record_document_form_field_mapping(
      current_setting('papertrail.test_form_mapping_inspection_id')::uuid,
      'declaration', current_setting('papertrail.test_form_mapping_text_fact_id')::uuid
    );
    raise exception 'text profile fact mapped to a checkbox';
  exception when raise_exception then
    if sqlerrm <> 'FORM_MAPPING_VALUE_TYPE_MISMATCH' then raise; end if;
  end;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
do $$
begin
  if exists (select 1 from public.document_form_field_mappings) then
    raise exception 'form mappings leaked across owners';
  end if;
end;
$$;
rollback;

-- W3: only an owner-requested, inspected and mapped ordinary form may produce a
-- separate review artifact. The worker result is fenced and rechecks its vector.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_fact_id uuid;
  v_inspection_id uuid;
  v_inspection_job_id uuid;
begin
  v_fact_id := public.record_owner_profile_fact('form.applicant_name', '"Asha Thomas"'::jsonb);
  select inspection_id, job_id into v_inspection_id, v_inspection_job_id
  from public.request_document_form_inspection('30000000-0000-4000-8000-0000000000a1');
  perform set_config('papertrail.test_derivative_fact', v_fact_id::text, true);
  perform set_config('papertrail.test_derivative_inspection', v_inspection_id::text, true);
  perform set_config('papertrail.test_derivative_inspection_job', v_inspection_job_id::text, true);
end;
$$;
reset role;
do $$
declare
  v_inspection_id uuid := current_setting('papertrail.test_derivative_inspection')::uuid;
  v_job_id uuid := current_setting('papertrail.test_derivative_inspection_job')::uuid;
begin
  update public.jobs set state = 'running', fencing_token = 1, lease_expires_at = now() + interval '90 seconds' where id = v_job_id;
  perform public.begin_document_form_inspection(v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_inspection_id, 0);
  if not public.record_document_form_inspection(
    v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_inspection_id, 0,
    'completed', 'fillable', null,
    jsonb_build_array(jsonb_build_object('name', 'applicant_name', 'kind', 'text', 'required', true, 'options', '[]'::jsonb))
  ) then raise exception 'derivative fixture could not complete inspection'; end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_run_id uuid;
  v_job_id uuid;
begin
  perform public.record_document_form_field_mapping(
    current_setting('papertrail.test_derivative_inspection')::uuid,
    'applicant_name', current_setting('papertrail.test_derivative_fact')::uuid
  );
  begin
    insert into public.artifact_generation_runs (owner_id, application_id, kind, input_version_vector)
    values (auth.uid(), '10000000-0000-4000-8000-0000000000a1', 'filled_acroform', '{}'::jsonb);
    raise exception 'AcroForm derivative runs must not allow direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  select artifact_run_id, job_id into v_run_id, v_job_id
  from public.request_private_acroform_derivative(
    '10000000-0000-4000-8000-0000000000a1', current_setting('papertrail.test_derivative_inspection')::uuid
  );
  if v_run_id is null or v_job_id is null then raise exception 'AcroForm derivative request did not return fenced IDs'; end if;
  perform set_config('papertrail.test_derivative_run', v_run_id::text, true);
  perform set_config('papertrail.test_derivative_job', v_job_id::text, true);
end;
$$;
reset role;
do $$
declare
  v_run_id uuid := current_setting('papertrail.test_derivative_run')::uuid;
  v_job_id uuid := current_setting('papertrail.test_derivative_job')::uuid;
  v_work record;
begin
  update public.jobs set state = 'running', fencing_token = 1, lease_expires_at = now() + interval '90 seconds' where id = v_job_id;
  select * into v_work from public.begin_private_acroform_derivative(
    v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_run_id, 0
  );
  if v_work.state <> 'ready' or v_work.object_path is null or v_work.field_values->>'applicant_name' <> 'Asha Thomas' then
    raise exception 'AcroForm derivative worker source did not retain the mapped fact snapshot';
  end if;
  if not public.record_private_acroform_derivative(
    v_job_id, 1, '00000000-0000-4000-8000-0000000000a1', v_run_id, 0,
    'filled-acroforms/integration/review-copy.pdf', repeat('d', 64), v_work.input_version_vector, 'passed'
  ) then raise exception 'fenced AcroForm derivative worker could not record output'; end if;
  if not exists (
    select 1 from public.artifacts where object_path = 'filled-acroforms/integration/review-copy.pdf'
      and kind = 'filled_acroform' and status = 'needs_review' and render_check_status = 'passed'
  ) then raise exception 'AcroForm derivative was not recorded as a review artifact'; end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
do $$
begin
  if exists (select 1 from public.artifacts where object_path = 'filled-acroforms/integration/review-copy.pdf') then
    raise exception 'AcroForm derivative leaked across owners';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare v_document_paths text[]; v_artifact_paths text[];
begin
  select document_object_paths, artifact_object_paths into v_document_paths, v_artifact_paths
  from public.remove_private_document('20000000-0000-4000-8000-0000000000a1');
  if not ('filled-acroforms/integration/review-copy.pdf' = any(v_artifact_paths)) then
    raise exception 'AcroForm derivative was not returned for source-document removal';
  end if;
  if not exists (
    select 1 from public.artifacts where object_path = 'filled-acroforms/integration/review-copy.pdf' and status = 'stale'
  ) then raise exception 'source-document removal did not stale its AcroForm derivative'; end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c3', true);
do $$
begin
  if not public.is_notice_moderator() then
    raise exception 'fixture failed: moderator role missing';
  end if;
  if (select count(*) from public.applications) <> 0 then
    raise exception 'A02 failed: moderator can read private applications';
  end if;
  begin
    update public.platform_roles set role = 'notice_moderator';
    raise exception 'A03 failed: ordinary authenticated role mutation succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare v_proposal_id uuid;
begin
  begin
    insert into public.directory_proposals (owner_id, institution_name, program_name, cycle_label, source_url)
      values (auth.uid(), 'Forged Institution', 'Forged Program', '2027', 'https://issuer.example/forged');
    raise exception 'directory proposal creation must not be direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  v_proposal_id := public.submit_directory_proposal(
    'Integration Institute', 'Integration Grant', '2027', 'https://issuer.example/grants/2027'
  );
  if not exists (
    select 1 from public.directory_proposals
    where id = v_proposal_id and owner_id = auth.uid() and state = 'submitted'
  ) then raise exception 'directory proposal was not owner-scoped and submitted'; end if;
  perform set_config('papertrail.integration_directory_proposal_id', v_proposal_id::text, true);
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b2', true);
do $$
begin
  if exists (select 1 from public.directory_proposals where institution_name = 'Integration Institute') then
    raise exception 'directory proposal leaked to a different owner';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c3', true);
do $$
declare v_proposal_id uuid; v_program_id uuid;
begin
  select id into v_proposal_id from public.directory_proposals where institution_name = 'Integration Institute';
  if v_proposal_id is null then raise exception 'moderator could not read submitted directory proposal'; end if;
  v_program_id := public.moderate_directory_proposal(v_proposal_id, 'approved', 'Integration review passed.');
  if v_program_id is null or not exists (
    select 1 from public.published_program_sources where proposal_id = v_proposal_id and program_id = v_program_id
  ) then raise exception 'moderator approval did not publish the public source'; end if;
end;
$$;
rollback;

do $$
declare
  first_reservation uuid;
begin
  first_reservation := public.reserve_budget(
    '40000000-0000-4000-8000-000000000001', 'model_inference',
    '00000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-8000-000000000001',
    'test-provider', 250, 'w1-first'
  );
  begin
    perform public.reserve_budget(
      '40000000-0000-4000-8000-000000000001', 'model_inference',
      '00000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-8000-000000000002',
      'test-provider', 100, 'w1-over-category'
    );
    raise exception 'A35 failed: category budget admitted unaffordable reservation';
  exception when raise_exception then
    if sqlerrm <> 'BUDGET_CATEGORY_EXHAUSTED' then raise; end if;
  end;
  perform public.mark_budget_charge_uncertain(first_reservation);
  begin
    perform public.settle_budget_reservation(first_reservation, 100, '{}'::jsonb);
    raise exception 'A36 failed: uncertain charge was settled/retried automatically';
  exception when raise_exception then
    if sqlerrm <> 'BUDGET_RESERVATION_NOT_ACTIVE' then raise; end if;
  end;
end;
$$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare
  v_activity_id uuid;
begin
  begin
    insert into public.tracked_activities (owner_id, activity_type, title, confirmation_state, tracking_state)
    values (auth.uid(), 'forged', 'Forged direct activity', 'owner_confirmed', 'active');
    raise exception 'owner activity creation must not be direct client DML';
  exception when insufficient_privilege then
    null;
  end;
  v_activity_id := public.create_owner_tracked_activity('certificate_renewal', '2027 residence certificate', '{}'::jsonb);
  if not exists (
    select 1 from public.tracked_activities
    where id = v_activity_id and owner_id = auth.uid()
      and confirmation_state = 'owner_confirmed' and tracking_state = 'paused'
  ) then
    raise exception 'owner activity intake did not create a paused confirmed private record';
  end if;
  if not exists (
    select 1 from public.activity_evidence
    where activity_id = v_activity_id and owner_id = auth.uid()
      and evidence_kind = 'owner_record' and confirmation_actor = 'owner'
  ) then
    raise exception 'owner activity intake did not retain owner-record provenance';
  end if;
end;
$$;
rollback;

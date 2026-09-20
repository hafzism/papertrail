begin;
select public.reserve_budget(
  p_campaign_id := '40000000-0000-4000-8000-000000000001'::uuid,
  p_category := 'live_voice'::text,
  p_owner_id := '00000000-0000-4000-8000-0000000000a1'::uuid,
  p_run_id := '60000000-0000-4000-8000-000000000001'::uuid,
  p_provider := 'test-provider'::text,
  p_amount_nano := 75::bigint,
  p_provider_request_id := 'concurrent-first'::text
);
select pg_sleep(1);
commit;

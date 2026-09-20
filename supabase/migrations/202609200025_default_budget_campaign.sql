-- The local PaperTrail campaign has a fixed $5 ceiling. Every provider call must
-- reserve against one of these categories before it is issued.

insert into public.budget_campaigns (
  name, allowed_nano, default_owner_limit_nano, default_run_limit_nano, state
) values (
  'papertrail-default', 5000000000, 5000000000, 5000000000, 'active'
) on conflict (name) do nothing;

insert into public.budget_category_limits (campaign_id, category, allowed_nano)
select campaign.id, limits.category, limits.allowed_nano
from public.budget_campaigns as campaign
cross join (values
  ('model_inference', 4500000000::bigint),
  ('integration_smoke', 500000000::bigint),
  ('live_voice', 0::bigint),
  ('transcription', 0::bigint),
  ('repair_contingency', 0::bigint)
) as limits(category, allowed_nano)
where campaign.name = 'papertrail-default'
on conflict (campaign_id, category) do nothing;

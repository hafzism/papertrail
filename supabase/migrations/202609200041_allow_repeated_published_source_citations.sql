-- Multiple independently reviewed proposals may legitimately cite the same public
-- issuer URL. Proposal identity remains unique, so dropping this convenience
-- uniqueness rule cannot duplicate a single moderation decision.
alter table public.published_program_sources
  drop constraint if exists published_program_sources_program_id_source_url_key;

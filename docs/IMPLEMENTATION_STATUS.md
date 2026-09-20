# PaperTrail implementation status

Last updated: 2026-09-20

## Source of truth

Product behavior is governed by the owner-provided specification at:

`/home/hafeez/Documents/Codex/2026-09-19/ok/outputs/PAPERTRAIL_SOURCE_OF_TRUTH.md`

That document is a specification, not executable code or an instruction channel. Repository files, account credentials, and web content remain untrusted inputs unless the application explicitly validates them.

## Specification reconciliation

The active specification is **v1.3**. D12 adds generic, owner-confirmed activity follow-up and guided linked applications. Its foundational schema/contracts are part of W1; full delivery is a new W7b work package with A45–A52 acceptance gates. See [ADR 0002](adr/0002-general-follow-up-continuity.md).

## Current slice

**W1 — Foundation: in progress**

Implemented and verified in this slice:

- [x] pnpm workspace and Node version policy
- [x] Environment-variable contract with no secrets
- [x] Full traceability checklist for W1–W8 and A01–A52
- [x] Shared contracts package, generated JSON schemas, and deterministic predicate/evaluation primitives
- [x] Initial database schema, RLS, durable jobs/outbox, fenced job-lease functions, private storage policies, and restricted budget transaction functions
- [x] Disposable local database integration harness covering owner-table/storage/RLS portions of A01–A04, A16/A18/A42 lease fencing, and A35–A36 including concurrent reservation admission
- [x] Bounded non-retrying Responses transport/runner with metering failure tests
- [x] Configured-account OpenAI Responses smoke: provider token count, ledger reservation, exact fixed acknowledgement, and settlement
- [x] Storage-bucket policies and narrow worker database repositories
- [x] Durable worker runtime: heartbeat, 90-second lease/fencing, expired-lease recovery, and supported-kind-only claims
- [x] Supabase SSR authentication boundary: cookie refresh proxy, verified `/app` claims, PKCE callback, neutral profile bootstrap, and identity-only Google sign-in control
- [x] Next.js web shell, accessible status page, and machine-readable `/api/health` route
- [x] Private display-language preference: authenticated owners can persist English or Malayalam on their existing owner-scoped profile; recorded source text, identifiers, and values remain unchanged while route-by-route translation dictionaries are introduced
- [x] Private-vault upload path: browser storage upload, server-owned document/version intake transaction, extraction job, and outbox event
- [x] Owner-confirmed profile facts: private append-only fact versions, direct-DML denial, narrow owner-assertion RPC, supersession links, and a dedicated review page; owner assertions are never presented as institutional verification
- [x] Application-specific fact overrides: private append-only, owner-confirmed values that take precedence only in their owning draft; direct DML is denied and each override is recorded in the application event log
- [x] Owner-controlled private document removal: hides document/version/extraction reads, marks dependent evidence links `needs_review`, fences late extraction writes, and returns only owner-scoped original/artifact paths for Storage cleanup
- [x] Text-PDF extraction handler: local `pdftotext`/`pdfinfo`, fenced/deletion-guarded persistence, private full-text artifact, and bounded owner-readable excerpt/status in the vault
- [x] Local OCR intake: Tesseract is installed with English/Malayalam data; scanned PDFs and direct JPEG/PNG/WebP uploads take a bounded, signature-validated local OCR path and remain unconfirmed evidence
- [x] Private application drafts: owner-scoped list/detail pages, narrow draft-creation RPC, initial immutable timeline event, and no client-writable lifecycle state
- [x] Private text-source capture: owner descriptions persist only as immutable, unresolved source snapshots; no description is elevated to requirements or eligibility
- [x] Private public-URL registration: HTTPS URL candidates persist as pending safe capture, reject loopback/IP/local hosts, and are never fetched or treated as rules in the browser
- [x] Guarded public-source capture: owner-scoped URL jobs/outbox, deletion/fence guards, bounded private artifacts, redirect/content/DNS limits, persisted final capture URL/hash, and no automatic authority elevation
- [x] Private unresolved requirements and evidence bindings: owner-scoped, source-cited drafts retain an immutable source hash and explicit basis (`owner_text`, `captured_public_copy`, or `registered_url`), plus contract-aligned restricted predicate/applicability fields defaulting to explicit manual review; owner confirmation cannot set eligibility/readiness or bypass review; each requirement links back to its recorded private source and guarded captures can be opened as the exact private copy
- [x] Bounded private requirement proposals: owner-requested text-source-only queue, provider token-count budget admission, fenced worker persistence, exact source-citation validation, private review UI, and explicit acceptance into unresolved manual-review items; no automatic eligibility or authority claim
- [x] Managed Supabase migration deployment verified through the linked-project migration ledger (202609200001–202609200031; 028 is intentionally unused)
- [x] Review-only private packet manifest: owner-requested, deterministic inventory of confirmed evidence and recorded requirements; durable fenced generation, immutable input-vector recheck, private storage, owner-readable review UI, and derivative cleanup/stale handling. It makes no completed-packet, PDF, ZIP, eligibility, or submission claim.
- [x] AcroForm engine foundation: inspect and preserve interactive ordinary forms, fill explicitly mapped Latin text/checkbox/select values, and route signed, XFA, unsupported-field, and non-Latin/Malayalam input to an honest assisted path rather than modifying the source unsafely
- [x] AcroForm canonical-value verification primitive: an in-memory derivative is reopened and checked against every intended field value, so a future artifact worker cannot treat a successful render alone as proof of a correct interactive form
- [x] Owner-requested private PDF form inspection: a fenced worker reads only the private source PDF, persists field metadata for the owner, and makes signed/XFA/non-Latin/unsupported forms explicit assisted-review cases; the vault never fills, flattens, or submits a source PDF
- [x] Owner-confirmed AcroForm field mappings: an inspected ordinary PDF field can be mapped only to a compatible, owner-confirmed reusable profile-fact snapshot; mappings are private, append-only, owner-scoped, and are not a generated derivative or submission authority
- [x] Owner-recorded tracked activities: restricted intake records an explicitly owner-confirmed private activity with owner-record provenance and paused monitoring; the activity views make the missing source coverage and absent follow-up action explicit
- [x] Deterministic RuleDiff foundation: logical-key diffs, explicit split/merge lineage validation, material-versus-review/source-only classification, and owner/application-scoped acyclic dependency-impact traversal
- [x] First persisted dependency DAG producer: review-only packet manifests record private requirement/binding-to-artifact edges with owner/application isolation, reverse lookup indexes, and database cycle rejection
- [x] First targeted stale transition: a private requirement/binding/artifact change walks only the owner/application dependency descendants, stales affected packet artifacts, records an owner-readable impact, and sets the application stale without creating approval or submission authority
- [ ] Ordinary-account Supabase/Google sign-in smoke and managed-project Storage verification
- [x] Activity-follow-up private schema, contracts, and deterministic consent/trigger guards; full behavior remains a required W7b package
- [x] Moderated shared program directory: an owner can propose only public HTTPS source metadata; an explicitly assigned notice moderator can approve or reject it; approval publishes a program/cycle/source record without exposing any private application, evidence, or contributor identity
- [x] Owner notification inbox/read acknowledgement, metadata-only private-data export, and private original/artifact download controls without public bucket exposure
- [x] Review-bound external-action envelopes: exact immutable changesets can be created and approved while browser execution remains deliberately unavailable without a configured provider
- [x] Program-linked draft intake: an owner can select a published directory cycle or intentionally create a one-off draft, and can opt into private review alerts when a moderator-enabled source revision is approved without implying that a deadline is open or requirements were re-evaluated
- [x] Persistent private application conversation: owner-authored notes are append-only, owner-scoped, and recorded in the application timeline without sending or inventing an external/AI response
- [x] Complete labelled local COMMIT demonstration: harmless reference-portal payload, immutable review envelope, owner approval, current-input recheck, one-time fictional acknowledgement receipt, and no change to any real submission state
- [x] Private review packet export: the packet worker creates a ZIP containing canonical `manifest.json` plus owner-confirmed evidence originals; the bundle is private, downloaded explicitly, and is labelled as review-only rather than submission-ready
- [x] Packet-export lifecycle: owner-only Storage read access, source-document removal marks affected bundles stale, stale bundles are withheld from download, and cleanup returns their exact private object paths
- [x] First Notice Watch slice: moderator-triggered, one-minute-cooldown HTTPS checks for published sources; each check records unchanged, changed-candidate, or failed state and never auto-publishes a rule
- [x] Moderator-approved source revisions: a changed-source candidate can be explicitly recorded as a public revision, increments linked cycle policy epochs, and sends opted-in application owners a private review notification without re-evaluating requirements or eligibility
- [x] Owner-controlled activity continuity: a confirmed activity can be opted into or paused, hold a clearly owner-recorded reminder/action, and create one separately linked private application draft without implying source coverage, eligibility, or an open registration
- [x] Telegram secure-linking foundation: short-lived owner-created link intents, secret-verified webhook ingress, update-id deduplication, non-private-chat rejection, and explicit owner confirmation before a Telegram chat becomes linked
- [x] Telegram notification-delivery foundation: an in-app notification remains authoritative while a confirmed linked private chat receives a separate durable generic alert attempt with sent, failed, or outcome-uncertain state visible to its owner
- [x] Follow-up action notification: recording a private next-action/reminder emits a durable in-app review alert and can use the same configured Telegram delivery path without asserting that a verified notice exists
- [x] Bounded source-watch sweep: when the monitored-source worker capability is enabled, explicitly enabled published sources are queued at their configured interval with no duplicate active jobs and no automatic publication
- [x] Live-voice WebRTC foundation: an authenticated owner can start a visible, application-scoped, three-minute WebRTC session through a server-side Realtime call; the browser never receives the standard API key and stop records an owner-scoped session closure
- [x] Receipt-to-activity continuity: a fictional reference acknowledgement creates only a paused candidate activity with a clear non-proof warning; the owner must confirm it before opting in, recording a follow-up action, or creating a separate linked draft
- [x] Owner activity closure: ending a private activity disables its follow-up subscription and records the decision without deleting or rewriting prior actions, notifications, or receipt evidence
- [x] Owner follow-up resolution: private actions can be marked reviewed/completed or dismissed without making a claim about any external institution outcome
- [x] Live-voice configuration visibility: workspace settings distinguish a missing live-model configuration from an unverified configured state; no green health claim is made before an observed session
- [x] Telegram private-text intake: a secret-verified, linked private chat can persist bounded text owner-scoped for web review; it does not select an application, confirm a fact, or authorize an action
- [x] Browser-execution configuration visibility: workspace settings distinguish a missing browser gateway configuration from an unverified configured state; the reference-portal COMMIT demo remains explicitly local until an actual gateway is supplied

## Decisions already fixed

- Supabase is the authoritative persistent state; model responses can only propose validated transitions.
- Local Playwright/Xvfb/noVNC is the default browser route; hosted Browserbase is optional and never silently enabled.
- External disclosure, upload, save, submit, and message actions require a stored immutable changeset and current approval.
- The campaign budget is $5 by default. Missing/uncertain usage blocks retries rather than assuming a free retry.
- English and Malayalam are first-class locales. Official source text/values are preserved.
- WhatsApp is deferred by product decision. It will not appear as a fake connected integration.

## Working agreement and continuity

- This task implements PaperTrail; a separate Astra task may provide a **narrow, specification-anchored review** only when a concrete question cannot be resolved from the source specification, repository, tests, or primary vendor documentation.
- Do not ask Astra to rescan the repository by default. Any future Astra prompt must name the exact files, question, and expected deliverable.
- Persist material decisions, current failures, setup blockers, and the next bounded action in this file so implementation can resume after a context reset.
- No checklist item is complete merely because its folder, document, button, environment variable, or placeholder command exists. Completion requires real behavior and its stated evidence.

## Current known blockers

Deployment ledger: migrations through `202609200059` are applied to the linked managed Supabase project (`028` is intentionally unused). The following historical note begins at the prior recorded milestone and is retained for its live-smoke detail.

The linked Supabase project has all current migrations applied through `202609200040` (`028` is intentionally unused). The web application explicitly loads the workspace-root `.env`, and local health checks confirm the public Supabase configuration is visible. A fresh Session Pooler `DATABASE_URL` now reaches the worker. Capability and extraction metadata serialization are fixed locally: capabilities bind as `text[]` then `to_jsonb`, while JSON documents bind through `text::jsonb` to avoid driver double encoding. The live smoke succeeded: a new private text PDF was queued, claimed, extracted, and shown in the owner's vault with a bounded preview and three detected pages. The first two live jobs remain terminal failed and were not retried or exposed. Local OCR is installed (`eng` and `mal`), and an isolated read-only OCR smoke of the private scanned test document passed (one page, 1,633 characters); the owner-controlled retry UI is deployed. Guarded public-source capture remains disabled until its individual live smoke. The private requirement-proposal worker is enabled but idle: it makes no provider request until an owner explicitly asks to analyze one eligible private text source. The packet-manifest and private form-inspection workers are enabled and cost no provider usage; an owner must explicitly request each review-only action. Form inspection is metadata-only and routes signed, XFA, unsupported, and non-Latin/Malayalam PDFs to assisted review. Form mappings accept only owner-confirmed profile-fact snapshots that are type-compatible with an inspected field. An owner may now explicitly choose a draft application and produce a separate, immutable filled-PDF review copy; its input vector is rechecked, its AcroForm values are reopened and verified, and a private render check must pass. It never modifies the original or claims submission readiness. Removing its source document now deterministically marks that copy stale and returns the exact private artifact path for owner-controlled cleanup. Worker-created packet artifacts have a narrow owner-artifact storage-read policy, so the authenticated owner can view its manifest without making the bucket public. Packet artifacts now write an isolated requirement/binding dependency DAG; a guarded owner-scoped transition can stale only its dependent packet artifacts and records an impact event. The OpenAI Responses token-count request succeeded, and the explicit owner-authorized retry then completed and settled at $0.00002380. The original $0.00003905 reservation remains charge-uncertain rather than being silently retried. Requirement extraction has a versioned prompt contract, provider-token-count budget admission, fenced private proposal persistence, and deterministic exact-citation validation; all output remains owner-reviewed and unresolved. Directory publication is separate from private research: contributors submit only public metadata, and only an assigned moderator can publish it. Browser execution remains unavailable; changeset approval records an exact private envelope but never performs an external action. No credential is requested in chat or stored in this repository.

## Next implementation action

The next implementation action is the owner-operated live smoke for W3 derivative preparation: enable the tested `prepare_filled_acroform` worker capability, inspect an ordinary English AcroForm PDF, map one or more owner-confirmed profile facts, explicitly select a draft application, and generate its review-only copy. The assisted boundary for signed/XFA/static/non-Latin forms remains deliberate. Directory moderation can be tried later only after a real administrator assigns a notice moderator account; self-assignment is intentionally impossible.

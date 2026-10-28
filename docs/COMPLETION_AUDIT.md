# Completion audit — 2026-10-28

The active goal is the original PaperTrail v1.3 product, with owner-selected OpenAI/Gemini BYOK. Production hosting/hardening and deep acceptance testing are deferred by the owner. This is not permission to replace product behavior with a placeholder or claim that all original features are done.

## Evidence obtained in this pass

| Area | Implemented behavior | Observed evidence |
|---|---|---|
| BYOK | Encrypted owner-scoped save/read/remove; metadata never includes ciphertext | `pnpm test:product`, both providers and cross-owner denial |
| Gemini transport | Actual application assistant transport, fictional input, no retry | One `gemini-2.5-flash` request returned HTTP 200 and `Gemini integration OK`; temporary key was memory-only and cleared |
| Application assistant | Persisted owner-bound conversation; current application context; visible proposed corrections | Live DB turn admission, duplicate claim denial, foreign-owner context denial, correction invalidation |
| Recorded audio | Bounded duration/size, provider transcription, editable text before sending | Parsing/unit checks; actual provider audio request remains a human smoke |
| Live voice | Application tools, visible transcript/status, session/task deduplication, server-side provider hangup jobs and campaign/session admission | DB tool replay/foreign-owner/closed-session checks; actual Realtime provider call not verified because configured OpenAI key returns 401 |
| Telegram | Durable deduplicated linked-private-chat intake; selected application; commands, documents/photos and recorded voice handling | Live DB queue/deduplication/unlink checks and media validation unit tests; current-device end-to-end message/media smoke remains |
| Browser execution | Exact reviewed fields and SHA-256 attachments; real isolated browser, actual uploads, actual independently persisted receipt | `pnpm test:e2e`: grant/exam/renewal pass through real web APIs, auth, Supabase, extraction and separate SQLite portal |
| Browser timeout | Acceptance withheld by portal, later status reconciliation, no second dispatch | Exam smoke verified independent portal submission count increases exactly once |
| Second form | Renewal has different field names, IDs, layout and button text | Renewal browser smoke passes using its specific adapter mapping |
| Receipt integrity | Recorded portal fields and attachment hashes must match immutable approval | Gateway verifies actual receipt DOM; web refuses mismatched receipt completion |
| Follow-up | Moderator-reviewed scope rules; missing fields require clarification; known mismatch is excluded; corrected scope can recover; opt-out stops evaluation | Transactional live DB smoke, with all synthetic shared directory/rule records rolled back |
| Linked draft/reminders | Stable action/draft link; owner reminder evidence provenance; deadline-window deduplication and delivery consent checks | Live DB follow-up smoke; no actual Telegram send during tests |
| Material changes | Fact/source/requirement/binding changes advance application version, invalidate approvals and obsolete in-flight answers; dependency-specific artifact staling | Live DB correction smoke and domain tests |
| Runtime | Web, independent portal, gateway and worker started; existing HTTPS tunnel restored to web | `pnpm healthcheck` with correct web port passes; tunnel upstream observed as `127.0.0.1:3010` |

`pnpm check`, `pnpm build`, and 62 unit tests passed. These checks prove only their stated scope, not every acceptance item.

## Required product work still open

1. **Real notice interpretation:** private requirement analysis still accepts owner-provided text only. Captured public HTML/PDF/scanned notice content must reach the same exact-citation proposal/review flow. Current capture supports HTML/plain text, not PDF notices.
2. **Static/Malayalam form preparation:** ordinary unsigned Latin AcroForms can be filled and checked. Static forms, Malayalam/non-Latin values, XFA and signed forms currently receive assisted states. The specified safe static overlay/companion-sheet workflow and Malayalam rendered output still need implementation. Signed/encrypted/XFA originals must remain untouched.
3. **Document transformations:** no full owner-selected photo resizing/compression or image-to-PDF derivative workflow with provenance/readability checks yet. Packet manifest/evidence ZIP already exists.
4. **Structured evaluation and repair:** deterministic primitives exist, but fully source-backed executable rules, R2 cohort distinctions, withdrawals, policy-epoch dispatch checks and targeted rebuild/correction UX are not all connected end-to-end.
5. **Guided linked applications:** scoped actions and linked drafts now work, but the complete prerequisite-aware questionnaire, saved actual portal choices, evidence reuse and cross-channel answer invalidation remain to be joined up.
6. **Shared notice lifecycle:** current moderation publishes source revisions and reviewed follow-up rules. Complete structured rule review, conflicting-source resolution and withdrawal fan-out remain.
7. **Localization and privacy:** language preference exists; full English/Malayalam interface dictionaries, full private export and account-level deletion are not complete. The existing JSON export is explicitly metadata-only; document removal is not account deletion.
8. **Interactive takeover:** code/container routing exists, but this machine currently has no running Docker daemon/display stack. Headless browser execution works; noVNC handover needs a headed gateway and one human smoke.

These are implementation items, not tasks to offload to the owner. Continue them without asking for permission or invoking Astra merely to rescan the repository.

## Owner-only checks at the end

- Save a fresh normal-use Gemini or OpenAI key in Settings. The temporary chat-shared Gemini key was not saved to any owner account; revoke it. Free-tier 429 responses must be shown honestly and never silently retried or switched to a paid fallback.
- Actual Google account sign-in, linked Telegram text/document/voice exchange, recorded audio transcription and microphone/device permissions need short human smokes once implementation is finished.
- Live Realtime voice requires valid OpenAI credentials; Gemini text/recorded-audio selection does not enable the current OpenAI Realtime integration.
- Start Docker/headed gateway for interactive takeover if that environment remains unavailable to the agent.
- Public deployment is still coming soon; the tunnel is temporary. No video/screenshots have been added, per owner instructions.

## Runtime/continuity

- Managed Supabase was restored to `ACTIVE_HEALTHY`; migrations through `202610280070` were actually applied. Do not repeat the old inactive-project blocker.
- Web: port 3010. Port 3000 belongs to another project and must not be stopped.
- Independent fictional portal: port 3001; persistent ignored SQLite under `data/reference-portal/`.
- Gateway: port 3002, headless for automated smoke. The test operator secret is fictional/loopback-only, not a production credential.
- Worker includes `process_telegram_intake` and an independent voice-close watchdog.
- Existing tunnel: `https://scorn-creation-armband.ngrok-free.dev` → `http://127.0.0.1:3010`. Never place that temporary URL in the README demo section.
- Existing workspace OpenAI key was rejected with HTTP 401. Do not repeat paid/provider probes with it.
- Next implementation slice: extend guarded source capture and proposal provenance to actual HTML/PDF/scanned notices; then static/Malayalam form workflow. Keep original source hashes, exact citations, owner isolation and explicit confirmation boundaries.

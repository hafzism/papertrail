# PaperTrail implementation checklist

Status legend: `[x]` complete, `[~]` in progress, `[ ]` not started, `[!]` requires an owner-controlled account or live service.

## Work packages

| ID | Scope | Status | Exit evidence |
|---|---|---:|---|
| W1 | Foundation: contracts, auth/RLS, isolation, queue/outbox, budget ledger | [~] | Two-owner DB tests; metered API adapter |
| W2 | Evidence: vault, extraction, confirmation, cited requirements/checklist | [~] | Actual notice + document produce reviewed state |
| W3 | Artifacts: AcroForm/static overlays, transforms, manifest/ZIP | [~] | English/Malayalam PDF visual evidence |
| W4 | Change engine: RuleDiff, dependency graph, repair, correction | [~] | Targeted stale/rebuild + immutable submission tests |
| W5 | Browser + COMMIT: gateway, portal, approval, reconciliation | [ ] | Takeover + timeout exactly-once submission |
| W6 | Shared notices: proposals, moderation, monitoring, fan-out | [~] | Moderated proposals, bounded periodic source watch, approved revision records, and opted-in application fan-out exist; full verified notice interpretation remains |
| W7 | Channels: Telegram, reminders, live/recorded voice | [~] | Secure Telegram linking/durable alert delivery and owner-bound live WebRTC session control exist; real Telegram and live-voice smoke evidence remains |
| W7b | General follow-up continuity: activity confirmation/consent, scoped actions, guided linked applications | [~] | Owner-controlled activity/action/linked-draft flow exists; A45–A52 across education and non-education fixtures remain |
| W8 | Usability/operations: localization, health, export/delete, runbook | [~] | Full acceptance suite + public rehearsal |

## Feature traceability

| Feature group | Specification sections | Package(s) | Status |
|---|---|---|---:|
| Identity, owner scope, language | §§3–5, 8.4, 20 | web, db, contracts | [~] |
| Private application drafts | §§4, 6.1, 8.3–8.4 | web, db | [~] |
| Private vault, extraction, facts | §§6, 9–10 | web, db, worker | [~] |
| Requirements and evidence bindings | §§5, 9–11 | domain, contracts, db, web | [~] |
| Forms, derivatives, packets | §10 | documents, worker, web | [~] |
| RuleDiff, impacts, repair | §§11, 14 | domain, db, worker | [~] |
| COMMIT, execution, receipts | §§13–15 | domain, browser, gateway, db | [ ] |
| Notices, moderation, monitoring | §§4, 12 | web, worker, db | [~] |
| AI and spending admission | §§16, 23 | ai, contracts, db, worker | [~] |
| Telegram and notifications | §17 | channels, web, worker | [~] |
| Live/recorded voice | §18 | web, ai, worker | [ ] |
| Generic activity follow-up | §§3 D12, 6.9, 9, 12.4 | contracts, domain, db, worker, channels, web | [~] |
| Privacy, export/delete, observability | §22 | db, observability, web, worker | [~] |
| Demo/reference portal | §25 | reference-portal, tests, scripts | [ ] |
| UI/accessibility/localization | §7 | web | [~] |

## Acceptance test register

### Security and integrity gates

- [~] A01 Cross-owner application/document row guessing and private storage-object reads are denied locally; authenticated API paths remain
- [~] A02 Moderator cannot read private application rows locally; full moderator API remains
- [~] A03 Authenticated role mutation is denied locally; production moderator-grant path remains
- [~] A04 Same file bytes remain isolated in document and private storage rows locally; application behavior remains
- [~] A18 SQL job claiming and stale-fence rejection are tested locally; execution dispatch remains
- [ ] A19 Changed payload invalidates approval
- [ ] A20 Publication/dispatch race is detected
- [ ] A21 Timeout-after-acceptance reconciles one submission
- [ ] A22 Crash after dispatch intent never blind-retries
- [ ] A25 Browser session/ticket is owner-bound and cleaned
- [ ] A26 Client cannot gain control by changing `viewOnly`
- [x] A35 Concurrent budget reservations cannot overallocate
- [x] A36 Unknown charge/usage blocks automatic retry
- [ ] A37 Audio/live campaign caps close or deny admission
- [ ] A38 Prompt injection/internal network targets are contained
- [ ] A39 Account deletion prevents late worker writes

### Product coverage

- [ ] A05 Text + scanned notice extraction has anchored citations
- [ ] A06 Ambiguous date evaluates `unknown`
- [ ] A07 Conflicting names remain unresolved, no altered certificate
- [ ] A08 Application-only override is isolated
- [ ] A09 Targeted RuleDiff invalidates only dependencies
- [ ] A10 Cosmetic source changes do not revoke work
- [ ] A11 R2 fixtures correctly distinguish A/B/C
- [~] A12 Contributor direct mutation is denied and moderator-gated publication is integration-tested; trusted-rule/fan-out behavior remains
- [ ] A13 Same-URL PDF byte change is detected
- [ ] A14 Failed fresh-source check pauses automatic submit
- [ ] A15 Withdrawal corrects without approval resurrection
- [~] A16 Queue claim primitives prevent a second active claim locally; publication idempotency remains
- [ ] A17 Late evaluation loses to newer input
- [ ] A23 Partial external success is retained and reviewable
- [ ] A24 Takeover re-inspects changed mapping
- [ ] A27 AcroForm/static Malayalam outputs render correctly
- [ ] A28 XFA/unreadable/protected inputs take honest assisted route
- [ ] A29 Compression preserves readability and provenance
- [ ] A30 Telegram link theft/expiry/replay/group input is denied
- [ ] A31 Telegram duplicate webhook/large file handling is safe
- [ ] A32 Telegram delivery failure retains in-app alert
- [ ] A33 Voice correction cancels obsolete work
- [ ] A34 Live outage is shown honestly
- [ ] A40 Deadline/quiet-hour semantics stay accurate
- [~] A41 SSR/PKCE Google sign-in and protected-route code build locally; ordinary-account and responsive-flow smoke remains
- [~] Lease heartbeat and stale-fence rejection are tested locally; full worker/browser restart recovery remains
- [ ] A43 Full notice-to-receipt reference flow works
- [ ] A44 Second portal + supported PDF have independent coverage
- [~] A45 Fictional reference receipt creates only a candidate activity pending owner confirmation/opt-in; full fixture evidence remains
- [ ] A46 Mixed activity cohorts scope correctly and ask on unknown progression
- [ ] A47 Guided linked application reuses valid evidence and asks actual choices
- [ ] A48 Prerequisite edit invalidates dependent answers across web/Telegram/voice
- [ ] A49 Repeated/revised notices update one action and revoke affected approval
- [ ] A50 Opt-out/deletion prevents late activity jobs or notifications
- [ ] A51 Full admission-to-exam follow-up retains original application and separate receipt
- [ ] A52 Non-education renewal uses the same engine; date reminders do not invent an open window

## Evidence still required before final completion

- [ ] Timestamped test command outputs
- [ ] Screenshots of English and Malayalam rendered PDFs
- [ ] Reference receipt plus independently verified one-record timeout case
- [ ] Redacted real Telegram exchange
- [ ] Live voice/session usage evidence
- [ ] Public-ingress browser takeover evidence
- [ ] Usage ledger compared with provider dashboard
- [ ] Supported/assisted portal and format matrix

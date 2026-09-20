# PaperTrail showcase pack

This folder is the presenter-facing companion to the implementation. It is deliberately honest about the current slice: PaperTrail can store private evidence, extract it, collect owner-confirmed facts, inspect ordinary AcroForms, create a separate review-only filled copy, and produce a deterministic private packet manifest. It does **not** yet submit applications, make eligibility decisions, or claim a completed packet.

## Start here

| File | Use |
|---|---|
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | A 5-7 minute spoken hackathon demo with exact click paths and fallback language. |
| [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md) | What can be claimed today, the proof behind it, and what must not be claimed. |
| [USER_JOURNEY.md](USER_JOURNEY.md) | The owner journey from a private document to reviewable outputs. |
| [MANUAL_DEMO_CHECKLIST.md](MANUAL_DEMO_CHECKLIST.md) | A short, ordered rehearsal and live-demo checklist. |
| [SHOWCASE_ONE_PAGER.pdf](../../output/pdf/SHOWCASE_ONE_PAGER.pdf) | Printable one-page project brief. |

## Demo asset convention

Use only fictitious, non-sensitive documents. Test PDFs and images belong in `tests/fixtures/showcase/`; never add personal resumes, IDs, notices, real signatures, keys, or source PDFs there. The fixture pack contains both the ordinary editable-form path and the deliberately assisted path, so the demo can show a safety boundary instead of pretending every PDF is editable.

## Presenter setup

1. Start the web app and one worker.
2. Ensure the worker enables `extract_document`, `inspect_acroform`, `prepare_filled_acroform`, and `prepare_packet_manifest`.
3. Sign in with the preconfigured demo account.
4. Create or retain one draft application named `Community Learning Grant`.
5. Use `tests/fixtures/showcase/ordinary-english-acroform.pdf` for the edit-and-review path once the fixture pack is present.

The manual demo checklist contains the precise commands and expected states. If the worker is not available during a presentation, demonstrate the completed private manifest and explain that it is persisted evidence from the same owner-scoped workflow; do not fabricate a new result.

## Integrity rules for a showcase

- Never show a real person's document or credentials.
- Keep the original document visible as an original; the generated review copy is a distinct private derivative.
- Say “owner-confirmed” for profile facts. Do not say “verified.”
- Say “review-only” for a packet manifest or filled copy. Do not say “ready to submit.”
- Demonstrate the assisted route for unsupported/signed/XFA/scanned/non-Latin forms as an intended product guardrail.


# Manual demo and smoke checklist

Use this with fictitious fixtures only. The whole happy-path rehearsal should take about five minutes after the local services are already running.

## Before the audience arrives

- [ ] Web app is running at `http://localhost:3000` and the demo account can sign in.
- [ ] The worker is started with the following capability list (preserve any already-enabled kinds):

  ```env
  WORKER_ENABLED_KINDS=extract_document,propose_private_requirements,prepare_packet_manifest,inspect_acroform,prepare_filled_acroform
  ```

- [ ] One draft application exists, ideally `Community Learning Grant`.
- [ ] Use only fixture files in `tests/fixtures/showcase/`.
- [ ] Keep a completed packet-manifest run open in a second tab as a fallback.

## Happy path: ordinary editable English form

1. Visit **Manage confirmed facts** (`/app/profile`) and save `demo.full_name` as `Asha Rahman` with value type **Text**. Expect an owner-confirmed fact, not verification.
2. Visit **Open private vault** (`/app/vault`) and upload `ordinary-english-acroform.pdf`. Wait for its private intake/extraction status.
3. On the document card choose **Inspect fields**. Expect the ordinary-form inspection to complete and expose form fields.
4. Map the fixture's `ApplicantName` text field to `demo.full_name`. Expect the mapping to be listed as private and owner-scoped.
5. Select `Community Learning Grant` and choose **Prepare review copy**. Keep the worker terminal visible only if useful.
6. Wait for the prepared artifact. Expect **needs review** and a successful render check. Download/open the copy and confirm `Asha Rahman` is visible while the original remains unchanged.
7. Open the application detail and choose **Prepare private packet manifest**. Expect a review-only private JSON inventory whose `submissionReady` field is `false`.

## Safety-boundary moment (recommended)

1. Upload `assisted-static-pdf.pdf` or `assisted-nonlatin-form.pdf`.
2. Inspect fields.
3. Show the honest **needs input/assisted** state. Say: “PaperTrail refuses to modify a PDF it cannot safely understand.”

## Pass conditions

- [ ] No original document is overwritten.
- [ ] No generated artifact is public.
- [ ] The ordinary form copy is explicitly review-only and field values are correct.
- [ ] The packet manifest loads privately and says `submissionReady: false`.
- [ ] The assisted sample is not silently filled or marked successful.

## If something is not ready

| Situation | Safe demo response |
|---|---|
| Worker is off | Show the already-completed manifest and the persisted vault state; do not promise a live generation. |
| Form is rejected | Use the assisted-boundary moment; it demonstrates the intended guardrail. |
| Manifest viewer does not load | Refresh once. If it still fails, do not show storage internals; present the completed job card and move to the feature inventory. |
| AI proposal is unavailable | Skip it. It is not required for the PDF and manifest demonstration. |


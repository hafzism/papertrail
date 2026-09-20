# PaperTrail hackathon demo script

**Target length:** 5-7 minutes  
**Audience takeaway:** PaperTrail helps an owner turn private documents into traceable review material while refusing unsafe edits and never pretending it submitted anything.

## 0:00 - 0:35 | Open with the problem

> Application work usually starts as a pile of private files, a form, and a deadline. The risky part is not typing into a field - it is losing track of what came from where, overwriting an original, or treating a guess as a verified fact. PaperTrail is built for the review step: private evidence in, explicit owner choices, and reviewable outputs out.

Show the **PaperTrail workspace**. Point to the private vault, confirmed facts, and draft applications.

## 0:35 - 1:25 | Establish the private evidence model

> I start by adding a document to a private vault. It stays private. The system can extract text or route a scanned input through a bounded local OCR path, but the document does not suddenly become a public notice or a verified claim.

Show the vault with a fictitious fixture already present, or upload `ordinary-english-acroform.pdf`.

> Notice the status language: this is evidence to review, not a verdict about eligibility.

## 1:25 - 2:05 | Confirm an owner fact

> Next, I save a reusable fact: `demo.full_name = Asha Rahman`. This label is intentional: owner-confirmed, not institutionally verified. It is a private value the owner is choosing to use in their own review workflow.

Open **Manage confirmed facts** and either show the existing fact or create it.

## 2:05 - 3:20 | Inspect before mapping

> Before PaperTrail can write anything, it inspects the PDF form. An ordinary AcroForm exposes its field structure. We only map an explicitly selected field to a compatible owner-confirmed fact.

In the vault, open the fixture, choose **Inspect fields**, then map `ApplicantName` to `demo.full_name`.

> The interesting part is what it refuses to do. A signed, XFA, static, unsupported, or non-Latin form takes an assisted route. PaperTrail does not silently flatten or alter a file it cannot safely understand.

Optional: show `assisted-static-pdf.pdf` already in the vault with its **needs input/assisted** status.

## 3:20 - 4:20 | Generate a separate review copy

> I now choose a specific draft application and prepare a review copy. The original upload is immutable. The worker creates a separate private artifact, reopens it to verify the field value, and requires a render check before it is shown as reviewable.

Select `Community Learning Grant`, choose **Prepare review copy**, and wait for the worker result. Open the private review copy.

> The artifact says `needs review`. That is the correct state. It is not permission to submit, and it does not claim the application is complete.

## 4:20 - 5:10 | Show the packet manifest

> Finally, the application can generate a deterministic private packet manifest: a JSON inventory of currently recorded requirements and confirmed evidence. It is useful for review because it is traceable, but it is explicitly not a filled PDF, ZIP, eligibility decision, or submission action.

Open the application and choose **Prepare private packet manifest**, then **View private manifest**. Point out:

- the application identity
- the recorded document/binding inventory
- `submissionReady: false`

## 5:10 - 5:45 | Close with the safety model

> The product value is not pretending automation can make high-stakes decisions. PaperTrail preserves originals, makes mapping explicit, keeps output private, and leaves a clear review boundary before any external action. The next work packages add controlled execution, notices, and channels - but this slice already demonstrates the private evidence and review foundation.

## If a live worker result is slow

Say this plainly:

> The job is durable and running asynchronously. Rather than hide that, I will show the completed artifact from this same private workflow and explain the immutable output boundary.

Show a completed manifest or completed review copy. Do not retry a job solely for the presentation, and do not replace the result with a manually edited file.


# Feature inventory and demo claims

This is a presentation inventory, not a roadmap promise. A checkmark means the repository contains the behavior and its local evidence; it does not imply production sign-off.

## Demonstrable now

| Capability | What the audience sees | Evidence / implementation boundary |
|---|---|---|
| Private workspace | Authenticated owner workspace with draft applications, vault, facts, and activities | Server-side auth boundary and owner-scoped database policies |
| Private evidence vault | Upload a PDF/image, see a private document, extraction state, and bounded text preview | Original is stored privately; full text is not turned into a public notice |
| Local text extraction and OCR routing | Text PDFs extract directly; scanned/image inputs use bounded local OCR where supported | Extraction remains unconfirmed evidence, not a verified claim |
| Owner-confirmed facts | Save a reusable fact or a draft-specific override | Append-only, owner-scoped values; no institutional verification claim |
| Form safety inspection | Inspect an ordinary PDF's fields before mapping anything | Signed, XFA, static, unsupported, and non-Latin/Malayalam inputs are routed to assisted review |
| Review-only filled PDF copy | Map a compatible fact, choose a draft, and prepare a separate filled copy | Original bytes remain untouched; values are reopened/verified and a render check must pass |
| Private packet manifest | Prepare a deterministic inventory of recorded requirements and confirmed evidence | It is JSON for review, not a ZIP, final packet, eligibility decision, or submission |
| Private review packet bundle | Download a ZIP with the review manifest and confirmed-evidence originals | The ZIP remains review-only and explicitly does not mean the application is ready or submitted |
| Private impact/staleness foundation | Changing/removing dependent evidence can mark downstream review artifacts stale | Impact is owner/application scoped; no automatic repair or external action |
| AI proposal boundary | Owner-requested requirement proposal path with metering/budget admission | Output is private and unresolved until the owner reviews it |
| Moderated public program directory | Submit public program metadata and an HTTPS source for review | Contributor records are private; only an explicitly assigned moderator can publish a directory entry |
| Review-bound action envelope | Create and approve an exact private portal-action review record | It is not browser automation or an external action; a provider still must be configured |
| End-to-end fictional portal demonstration | Prepare a harmless test payload, approve it, and record one local acknowledgement | The portal is visibly fictional/local; it never contacts a real institution or changes a real submission state |

## Do not claim in the demo

| Not yet delivered | Safe wording |
|---|---|
| Application submission or portal automation | “PaperTrail is preparing reviewable evidence. It does not submit anything in this slice.” |
| Eligibility or institutional verification | “The product records owner-confirmed facts; it does not verify them with an issuer.” |
| Universal PDF editing | “Only supported ordinary AcroForms are filled. Other documents take an assisted path.” |
| A completed application packet | “This manifest is a private inventory, not a final packet or a permission to submit.” |
| Messaging, Telegram, voice, or browser takeover | “Those work packages are still planned and are not shown as working features.” |
| Automatic public-source monitoring | “The directory records reviewed sources; monitoring and fan-out are not yet enabled.” |

## Sharp one-sentence pitch

**PaperTrail turns scattered private documents into traceable, owner-reviewed application evidence without quietly changing originals or making submission decisions.**

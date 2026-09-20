# User journey: private evidence to a reviewable copy

```text
Owner signs in
     |
     v
Creates a private draft application
     |
     +-------------------------+
     |                         |
     v                         v
Uploads private evidence   Records owner-confirmed facts
     |                         |
     v                         |
Document is extracted /       |
OCR-routed privately          |
     |                         |
     +------------+------------+
                  |
                  v
        Inspects an ordinary PDF form
                  |
       +----------+----------+
       |                     |
       v                     v
Supported form          Signed/XFA/static/non-Latin/
field + compatible      unsupported form
owner-confirmed fact          |
       |                     v
       v                Assisted review, no unsafe edit
Maps fields explicitly
       |
       v
Chooses a draft application
       |
       v
Worker creates a separate private review copy
and verifies the filled field values + render
       |
       v
Owner reviews artifact / prepares a private
packet manifest
       |
       v
Still no submission, eligibility decision,
or claim of completeness
```

## Why this journey matters

1. **Private by default.** Documents, fact snapshots, mappings, and generated artifacts are owner-scoped.
2. **Explicit inputs.** A fact is never silently mapped; the owner selects the field, compatible fact, and draft context.
3. **Immutable originals.** The fill path produces a new, private review copy and never overwrites the upload.
4. **Honest boundaries.** If PaperTrail cannot safely handle a PDF, it says so and routes to review rather than pretending it succeeded.
5. **Traceable review.** A packet manifest describes the current recorded evidence state but does not become a submission button.


# PaperTrail demo fixture pack

All material in this directory is fictional and is safe to upload to a local PaperTrail demo. The fixtures are intentionally small, named in recommended showcase order, and are not evidence, official forms, or submission documents.

## Fast happy-path demo

Use `01-ordinary-acroform-review-copy.pdf`.

1. Create harmless confirmed profile facts: `test.name` as text with `Asha Thomas`, `test.declaration` as boolean with `true`, and `test.category` as text with `student`.
2. Upload the PDF to the private vault and choose **Inspect fields**. Expected result: `fillable`, with `applicant_name` (text), `owner_declaration` (checkbox), and `applicant_category` (dropdown).
3. Map each compatible field to a confirmed profile fact, choose a draft application, then choose **Prepare review copy**.
4. With `prepare_filled_acroform` enabled in the worker, expect a separate private review PDF with status `needs review` and a passed render check. The uploaded original must remain unchanged.

## Safety-boundary fixtures

| File | Intended behavior |
| --- | --- |
| `02-malayalam-value-assisted-route.pdf` | The source form is ordinary, but map or request a Malayalam value such as `അനു`; derivative preparation must take the assisted route rather than automatically modifying the PDF. |
| `03-scanned-image-only-notice.pdf` | No native text or AcroForm fields. The image-only source should use PaperTrail's OCR intake path and should never be treated as confirmed evidence just because text was extracted. The PNG used to make it is retained in `source-images/`. |
| `04-signed-marker-assisted.pdf` | A deliberate `/Sig` safety-marker fixture. Inspection must take the assisted route. It does **not** pretend to be a legally signed PDF. |
| `05-xfa-marker-assisted.pdf` | A deliberate `/XFA` safety-marker fixture. Inspection must take the assisted route. It does **not** pretend to be a full Adobe XFA package. |

## Showcase files

`06-project-showcase-handout.pdf` is a three-page companion handout for a presentation or screen recording. `source-images/project-showcase-flow.png` is the workflow graphic embedded in that handout and can be used as a slide image.

## Verification notes

The ordinary form deliberately uses only field classes currently supported by the W3 worker: text, checkbox, and dropdown. The default PDF values are blank so that generated review copies visibly demonstrate the mapped values. All supported final PDFs are visually rendered and their AcroForm field inventory is checked after generation.

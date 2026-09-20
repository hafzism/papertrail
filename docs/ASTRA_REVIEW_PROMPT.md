# Astra companion prompt

Use Astra only for a focused senior-review question. Do not ask it to scan the repository, restate the specification, or propose a new product plan when the exact concern can be tested or resolved here.

Attach `PAPERTRAIL_SOURCE_OF_TRUTH.md` only when the named question needs it, then use this template:

> You are reviewing one bounded PaperTrail implementation question. The governing product specification is `PAPERTRAIL_SOURCE_OF_TRUTH.md`. Review **only** these files: `[exact paths]`. Question: `[one precise unresolved issue]`. Check only these specification sections: `[exact sections]`. Do not scan unrelated files, change scope, invent integrations, or make code changes. Return only: `finding | evidence in named files | specification reference | minimal recommended fix`.

Before invoking Astra, confirm the question cannot be settled by current tests, the repository, or primary vendor documentation. Record any adopted finding in `docs/IMPLEMENTATION_STATUS.md` or an ADR.

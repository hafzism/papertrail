# ADR 0002: Generic opt-in activity follow-up

Date: 2026-09-20

## Context

Specification v1.3 adds D12: PaperTrail must support confirmed, tracked administrative activities and guided subsequent applications. Admission-to-exam is one fixture, not the product model.

## Decision

Implement one private generic activity model, introduced at the database/contract boundary in W1 and delivered end-to-end in W7b.

- A receipt or document creates at most a `candidate` activity. It does not prove approval, issuance, enrollment, or progression.
- Owner confirmation and monitoring opt-in are separate, versioned decisions.
- Public notice matching is scope-first and per-owner; unknown scope/status creates clarification rather than a claim that action is required.
- A stable `(activity_id, action_family_key, action_period)` identifies a follow-up action. Revisions update it rather than duplicating a registration/application.
- A linked follow-up application is a normal PaperTrail application with its own COMMIT and receipt. It may reuse evidence only after requirement validation.
- A due-date reminder and an open renewal window are distinct trigger types.

## Consequences

- The database must keep activity data private and owner-scoped, with no public catalog or moderator access.
- Notifications may link to an activity/action without inventing an application.
- W7b requires education and non-education fixtures through the same tables, evaluator, questionnaire, job, and receipt paths.


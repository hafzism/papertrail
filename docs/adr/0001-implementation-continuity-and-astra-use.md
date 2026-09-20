# ADR 0001: Implementation continuity and targeted Astra review

Date: 2026-09-20

## Decision

Maintain implementation continuity in repository documentation. Use Astra only for a bounded, explicitly named senior-review question when the source specification, executable tests, local implementation, and primary vendor documentation cannot settle it efficiently.

## Consequences

- Normal implementation, debugging, and code review remain in this task.
- An Astra request must include the exact files/sections to inspect, the question, and expected response format; it must not ask for a blanket repository scan.
- Findings are treated as review input and verified against the specification and implementation before they change scope or code.
- `docs/IMPLEMENTATION_STATUS.md` remains the concise recovery point after context loss.


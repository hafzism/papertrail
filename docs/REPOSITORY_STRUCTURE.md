# Repository structure and ownership

The directories below are intentional implementation boundaries. They are created as their work package begins; no folder is treated as proof that its feature works.

| Location | Responsibility | First work package |
|---|---|---:|
| `apps/web` | Next.js application UI, API routes, locale dictionaries, and status/health boundary | W1/W8 |
| `apps/worker` | Durable queue runtime and consumers: extraction, monitoring, impacts, delivery. It only claims registered, tested kinds. | W1 |
| `apps/browser-gateway` | Owner-bound WebSocket/takeover boundary | W5 |
| `apps/reference-portal` | Clearly fictional issuer portal, notices, receipts | W5 |
| `packages/contracts` | Zod schemas, types, JSON-schema generation | W1 |
| `packages/domain` | Predicates, RuleDiff, state machines, approval validation, activity state/scope/action identity | W1/W4/W7b |
| `packages/db` | Typed queries and narrow transactional repositories | W1 |
| `packages/ai` | Responses adapter, prompts, budget admission | W1/W2 |
| `packages/documents` | Parsing, transforms, PDF mapping, manifests | W2/W3 |
| `packages/browser` | Provider interface and local/configured adapters | W5 |
| `packages/channels` | Telegram and neutral channel contracts | W7 |
| `packages/observability` | Redacted events, correlation IDs, usage accounting | W1/W8 |
| `supabase/migrations` | Versioned schema, RLS, functions, indexes, queue/cron | W1 |
| `infra/browser-runner` | Isolated Chromium/Xvfb/VNC supervisor | W5 |
| `scripts` | Setup, health, fixtures, demo reset, restricted moderator grant | W1/W8 |
| `tests` | Unit, DB integration, browser E2E, generated fixtures | W1 onward |
| `docs` | Setup, decision records, evidence, test reports | W1 onward |

The generated design system is in `design-system/papertrail/`. Its recommendations are used only where consistent with the product specification.

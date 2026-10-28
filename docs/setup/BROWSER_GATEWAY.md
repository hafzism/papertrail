# Local browser gateway

The local browser gateway is an isolated, one-slot headed Chromium process. It opens only `BROWSER_ALLOWED_ORIGINS`, gives each session a fresh browser context, and exposes VNC only inside its container. It is not the developer desktop and does not accept arbitrary scripts, selectors, or model-provided destinations.

## Development configuration

Add these values to the existing uncommitted `.env`; do not send them in chat.

```env
BROWSER_PROVIDER=local
BROWSER_GATEWAY_INTERNAL_URL=http://127.0.0.1:3002
BROWSER_GATEWAY_SECRET=<a-random-secret-at-least-24-characters>
BROWSER_ALLOWED_ORIGINS=http://reference-portal:3001
REFERENCE_PORTAL_ORIGIN=http://reference-portal:3001
BROWSER_GATEWAY_PUBLIC_ORIGIN=http://localhost:3002
BROWSER_MAX_CONCURRENT=1
```

`BROWSER_ALLOWED_ORIGINS` is an exact comma-separated allowlist. Do not use `*`, a broad host suffix, or a real portal until its scope has been reviewed. Compose starts a separate persistent fictional portal reachable as `http://reference-portal:3001` inside the private container network. Set `REFERENCE_PORTAL_ORIGIN` to that same internal origin in the web process and restart it. The host's portal preview remains available at `http://localhost:3001`. Never use `localhost:3001` as a container destination: that means the gateway container itself, not the host.

The gateway has bounded adapters for fictional grant, exam and renewal forms under `/apply/`. The renewal layout uses separate field identifiers. The immutable approval includes exact fields, file versions/hashes, declaration and destination. The gateway fills fields, uploads actual bytes, inspects the portal review, submits once and verifies the receipt's recorded fields and hashes. Its execute endpoint accepts only the preapproved action ID, not new values, selectors or scripts. Other portals require a reviewed portal-specific adapter.

Start it from the repository root:

```bash
docker compose --env-file .env -f infra/browser-runner/docker-compose.yml up --build -d
curl http://127.0.0.1:3002/health
```

Expected health result contains `"status":"ok"` and `"maxConcurrent":1`. Stop it with:

```bash
docker compose --env-file .env -f infra/browser-runner/docker-compose.yml down
```

Stop existing native processes on ports 3001/3002 before switching to Compose. `down` preserves the fictional portal's named data volume. Do not add `--volumes` unless you explicitly intend to discard that demonstration history.

## Headless development and smoke

Without Docker, run `pnpm dev:portal` on the host, set both `REFERENCE_PORTAL_ORIGIN` and `BROWSER_ALLOWED_ORIGINS` to `http://127.0.0.1:3001`, and launch the gateway with `BROWSER_HEADLESS=true` after installing Playwright Chromium. This supports real browser fill/upload/receipt smoke but deliberately cannot issue a noVNC takeover ticket.

`pnpm test:e2e` uses a temporary Supabase owner and fictional evidence against the real web/API/gateway/portal stack. It is a narrow product smoke, not proof of every acceptance gate. Its timeout injection additionally requires a loopback test portal started with `DEMO_MODE=true` and a private `DEMO_OPERATOR_SECRET`, supplied to the smoke as `PAPERTRAIL_SMOKE_OPERATOR_SECRET`. Never enable the operator endpoint on a public real-data portal. A receipt is reconciled by status lookup; the test independently verifies exactly one recorded submission.

## Takeover routing

The gateway issues a 30-second, single-use URL only to an already authenticated PaperTrail server. The URL serves noVNC from the gateway and upgrades a same-origin WebSocket to the private container VNC socket. The VNC and Chromium debugging ports are not published to the host.

For a remote/HTTPS PaperTrail demo, serve the gateway through the same HTTPS reverse proxy or a separately protected HTTPS origin, then set `BROWSER_GATEWAY_PUBLIC_ORIGIN` to that exact origin. A browser will block an HTTP takeover page embedded in an HTTPS app. Do not expose port 3002 directly to the public internet.

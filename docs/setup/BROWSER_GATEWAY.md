# Local browser gateway

The local browser gateway is an isolated, one-slot headed Chromium process. It opens only `BROWSER_ALLOWED_ORIGINS`, gives each session a fresh browser context, and exposes VNC only inside its container. It is not the developer desktop and does not accept arbitrary scripts, selectors, or model-provided destinations.

## Development configuration

Add these values to the existing uncommitted `.env`; do not send them in chat.

```env
BROWSER_PROVIDER=local
BROWSER_GATEWAY_INTERNAL_URL=http://127.0.0.1:3002
BROWSER_GATEWAY_SECRET=<a-random-secret-at-least-24-characters>
BROWSER_ALLOWED_ORIGINS=https://your-fictional-portal.example
BROWSER_GATEWAY_PUBLIC_ORIGIN=http://localhost:3002
BROWSER_MAX_CONCURRENT=1
```

`BROWSER_ALLOWED_ORIGINS` is an exact comma-separated allowlist. Do not use `*`, a broad host suffix, or a real portal until its scope has been reviewed. The gateway has one bounded executable adapter: the repository's fictional `/reference-portal` acknowledgement. It receives a prevalidated immutable action payload only when the session is created; the execute endpoint accepts only that action ID. It rejects caller-provided selectors, scripts, URLs, and field values. All other external portals remain observe/takeover-only until a portal-specific adapter validates an already approved immutable changeset.

Start it from the repository root:

```bash
docker compose --env-file .env -f infra/browser-runner/docker-compose.yml up --build -d
curl http://127.0.0.1:3002/health
```

Expected health result contains `"status":"ok"` and `"maxConcurrent":1`. Stop it with:

```bash
docker compose --env-file .env -f infra/browser-runner/docker-compose.yml down
```

## Takeover routing

The gateway issues a 30-second, single-use URL only to an already authenticated PaperTrail server. The URL serves noVNC from the gateway and upgrades a same-origin WebSocket to the private container VNC socket. The VNC and Chromium debugging ports are not published to the host.

For a remote/HTTPS PaperTrail demo, serve the gateway through the same HTTPS reverse proxy or a separately protected HTTPS origin, then set `BROWSER_GATEWAY_PUBLIC_ORIGIN` to that exact origin. A browser will block an HTTP takeover page embedded in an HTTPS app. Do not expose port 3002 directly to the public internet.

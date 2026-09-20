# Owner-controlled setup requirements

These items are intentionally **not** requested as secrets in chat. Continue building without them until a live integration smoke test is due.

## Current local project state

The linked Supabase project, Google sign-in, Storage, worker database access, local OCR, and the configured OpenAI project have already been set up and exercised in this workspace. Do not send credentials in chat. The remaining owner-controlled setup is only needed when its corresponding feature is implemented: a Telegram bot/public HTTPS ingress for W7, a browser gateway/public ingress for W5, and live voice account access for W7.

## Needed before managed-project database/auth smoke tests

1. A Supabase project created for PaperTrail (Free tier is sufficient).
2. Its project URL and publishable key placed locally in `.env` by you as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is supported only for setup compatibility.
3. Its service-role key and a fresh **Session Pooler** database URL from Supabase Connect placed locally in `.env` as `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL`, never pasted into this chat. Do not use the IPv6-only direct `db.<project-ref>.supabase.co:5432` address on this machine; the worker cannot reach it. The previously cached CLI pooler credential was rejected, so obtain a fresh URL from the dashboard rather than reusing a saved value.

## Supabase Auth setup for the implemented sign-in path

1. Create the PaperTrail project and copy `.env.example` to an uncommitted root `.env` file. The web configuration explicitly loads this workspace-root file; do not create a second environment file under `apps/web`.
2. Add the project URL and **publishable** key from the project Connect dialog. Add the database URL and service-role key only to that local file; the browser must never receive them.
3. Apply the repository migrations in order with the Supabase CLI: `npx supabase@latest link --project-ref <your-project-ref>`, then `npx supabase@latest db push`. Do not paste SQL fragments piecemeal into the dashboard; the migration order is part of the audit trail.
4. In Supabase Auth URL configuration, add `http://localhost:3000/auth/callback` to the Redirect URLs. Use the future exact HTTPS public callback URL as an additional redirect only when it exists.
5. In Google Cloud, create a Web OAuth client whose authorized redirect URI is the exact Supabase callback shown in the Google provider page (normally `https://<project-ref>.supabase.co/auth/v1/callback`). Put the Google client ID and secret in the Supabase Google provider settings, enable the provider, and do not request Gmail or Drive scopes.
6. Start `pnpm dev`, visit `http://localhost:3000/login`, and sign in with an ordinary non-team Google account. Do not report credentials; report only the resulting success screen or a redacted error.

## Needed before the document-extraction worker smoke

1. Complete the fresh Session Pooler `DATABASE_URL` step above.
2. Set `WORKER_ENABLED_KINDS=extract_document` in the same uncommitted root `.env` file.
3. Start `pnpm --filter @papertrail/worker start` in a second terminal. It uses local `pdftotext`/`pdfinfo` for text PDFs and local Tesseract for scanned PDFs and JPEG/PNG/WebP images when configured. It writes full extracted text to private artifact storage and never invents extracted content.

## Local OCR for scanned PDFs and images

Text-only PDFs already work. For PDFs whose pages are images and for direct JPEG/PNG/WebP uploads, install the free local Tesseract engine and English language data, then set `OCR_LANGUAGES=eng` in the uncommitted root `.env` and restart the worker. On Ubuntu/Debian, the owner-controlled installation is:

```bash
sudo apt-get update
sudo apt-get install tesseract-ocr tesseract-ocr-eng
```

For Malayalam scans, also install `tesseract-ocr-mal` and use `OCR_LANGUAGES=eng+mal`. OCR output remains unconfirmed evidence; PaperTrail records its engine version and never silently repairs a source document.

The Next.js code uses cookie-based Supabase SSR, Next 16’s `proxy.ts`, verified claims—not unverified session data—for `/app`, and PKCE code exchange on `/auth/callback`. It follows the current [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client) and [Google provider guide](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Local W1 database test path

`pnpm test:integration` already runs a disposable Docker Postgres test for migrations and RLS. It does not require a Supabase account or CLI. Managed-project Storage/RLS and ordinary-account authentication smoke tests remain required before deployment.

## Needed before provider smoke tests

1. A dedicated OpenAI API project/key with the selected model access.
2. Confirmation of available model IDs and current rate card; the app stays at a $5 campaign cap.
3. A Telegram bot, HTTPS reachable origin, webhook secret, and bot username for W7.
4. Google OAuth configured in Supabase for identity-only sign-in and the final allowed redirects.

## Needed before public rehearsal

1. A running host or this machine kept awake, plus HTTPS ingress (Quick Tunnel is acceptable).
2. Updated `APP_ORIGIN`, Supabase redirects, and Telegram webhook together.
3. A fictional demo moderator account ID for the restricted moderator-grant script.

## Needed before the implemented Telegram-link smoke

1. Create a Telegram bot with BotFather. Put its token, a long random webhook secret, and its username (without `@`) only in the uncommitted root `.env` as `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_BOT_USERNAME`.
2. Start PaperTrail behind a public HTTPS origin, update `APP_ORIGIN` and the Supabase allow-list with that exact origin, then set Telegram's webhook to `https://<public-origin>/api/channels/telegram/webhook` using the same secret. Do not use a temporary URL after it has expired.
3. Open **Workspace settings → Telegram private chat**, create a link, open the generated bot link in a private Telegram chat, and return to explicitly confirm the chat. A successful link is not yet a successful message-delivery smoke.

The current implemented endpoint accepts only secret-authenticated updates, deduplicates bot update IDs, and rejects group/non-private linking. To enable the implemented generic alert worker after a chat is linked, add `deliver_telegram_notification` to `WORKER_ENABLED_KINDS` and restart a worker. Delivery status appears in the in-app inbox; a sent state means Telegram accepted the request, never that the owner read it. Linked private-chat text is persisted in Workspace settings for owner review but never selects an application, confirms a fact, or authorizes an action. Telegram documents and voice notes remain disabled until their dedicated intake slice is implemented.

## Needed before the implemented live-voice smoke

1. Confirm your OpenAI project has access to a supported Realtime model, then set that exact model ID as `MODEL_LIVE` in the uncommitted root `.env`. Keep `OPENAI_API_KEY` server-only.
2. Restart the web server. The **Live voice** panel appears inside an application only when both values are present.
3. Use harmless demo data, allow the browser microphone prompt only after pressing **Start live voice**, speak briefly, and press **Stop voice**. The UI has a three-minute maximum and the standard API key never reaches the browser.

PaperTrail uses the server-side WebRTC-call endpoint described in the official [OpenAI Realtime API reference](https://platform.openai.com/docs/api-reference/realtime?lang=javascript). A real smoke must still confirm your project’s actual model entitlement and browser network permissions.

## Never provide here

Do not paste API keys, service-role keys, bot tokens, passwords, OTPs, real documents, or production portal credentials into chat, commits, screenshots, or project documentation.

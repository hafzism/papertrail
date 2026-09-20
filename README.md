# PaperTrail

## Overview

PaperTrail is a private, evidence-first workspace for preparing and maintaining application drafts. It keeps documents, extracted text, source notes, owner-confirmed facts, review records, and follow-up activity in one accountable workspace. The product is designed to help people stay organized without claiming to determine eligibility or submit anything on their behalf.

## Problem Statement

Important applications are often spread across PDFs, screenshots, changing public notices, personal notes, and follow-up reminders. That makes it difficult to know which evidence supports a requirement, what has changed, and what still needs a human decision.

## Solution

PaperTrail creates a private trail from source material to review. Users can upload evidence, inspect extracted content, capture private source descriptions, review AI-generated requirement proposals, record their own facts, prepare a review-only packet manifest, and track follow-up work. Any external-action demonstration is protected by an explicit review step and clear owner control.

## Features

- Private document vault with versioned uploads, text extraction, OCR routing, and review states for image-only documents.
- Private source capture and OpenAI-assisted requirement proposals that remain proposed until the owner accepts them.
- Owner-confirmed reusable facts, application-specific overrides, evidence bindings, and review-only packet manifests/exports.
- Tracked activities, follow-up actions, source-change monitoring, notifications, and private Telegram chat linking.
- OpenAI Realtime voice-assisted review, with microphone access requested only when the user starts a session.
- Review-bound action records, a fictional reference-portal demonstration, and an isolated local browser gateway for safe browser-session inspection and takeover.

## Tech Stack

- *Frontend:* Next.js 16, React 19, TypeScript, Tailwind CSS
- *Backend:* Next.js route handlers, TypeScript worker processes, PostgreSQL functions
- *Database:* Supabase Postgres, Row Level Security, Supabase Auth, Supabase Storage
- *APIs / Services:* OpenAI Responses API, OpenAI Realtime API, Telegram Bot API, Google OAuth through Supabase
- *Hosting / Deployment:* Local development with Docker and optional HTTPS tunnelling; permanent demo deployment coming soon
- *Other Tools:* pnpm workspaces, Playwright, Docker Compose, Xvfb, x11vnc/noVNC, Tesseract OCR, Poppler, Vitest

## Codex / OpenAI Usage

PaperTrail was built as an agentic hackathon workflow using Codex and OpenAI models throughout the project.

- GPT-6 Astra was used for the initial project architecture, research, and senior-level source-of-truth planning.
- GPT-5.6 Sol was used for senior implementation planning, coordination, debugging, and product decisions.
- GPT-5.6 Terra side agents were used for parallel work such as fixture generation, proposal-review UI, showcase material, and browser-gateway implementation.
- Codex goal tracking, side tasks, mobile remote continuity, and iterative review workflows were used to keep the build moving across implementation stages.
- OpenAI APIs power requirement proposal assistance and live voice review inside the product.
- AI assistance also accelerated code generation, debugging Supabase migrations and storage policies, test coverage, documentation, demo fixtures, and UI/UX iteration.

## Demo

### Live Demo

Coming soon.

### Demo / Pitch Video

Coming soon.

A short demo/pitch video will show the evidence-to-review workflow, private packet manifest, activity continuity, Telegram integration, and live voice review.

## Screenshots

Final product screenshots will be added after the current UI redesign pass.

## How to Run Locally

```bash
git clone https://github.com/hafzism/papertrail.git
cd papertrail
cp .env.example .env
pnpm install
npx supabase@latest link --project-ref <your-project-ref>
npx supabase@latest db push
pnpm dev
```

In a second terminal, start the worker:

```bash
pnpm --filter @papertrail/worker start
```

For the optional isolated local browser gateway:

```bash
docker compose --env-file .env -f infra/browser-runner/docker-compose.yml up --build -d
```

See [setup requirements](docs/setup/SETUP_REQUIRED.md) for the local environment values, OAuth configuration, worker capabilities, Telegram setup, browser gateway configuration, and OpenAI model setup. Never commit `.env` or paste secrets into issues, screenshots, or chat.

## Additional Notes

Hackathon build status: complete.

PaperTrail is intentionally private and owner-controlled. Extracted content, AI proposals, activity records, and external-action review artifacts remain review material; they do not represent institutional verification, eligibility decisions, or permission to submit.

The repository includes a fictional demonstration portal and generated fictional PDF fixtures so the workflow can be demonstrated without using real applicant or institutional data.

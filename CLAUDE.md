# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

meCove is a journaling backend with two channels: WhatsApp (via Meta webhook) and a native mobile app (REST API). It stores messages in PostgreSQL, generates AI-powered acknowledgment replies, and produces periodic summary reports as PDFs.

## Tech Stack

- **Runtime:** Node.js 20, TypeScript (ES2022, CommonJS)
- **Package manager:** pnpm
- **Database:** PostgreSQL 16+ with Prisma 7 (using `@prisma/adapter-pg` native driver adapter)
- **Queue:** BullMQ on Redis 7+ (via ioredis)
- **LLM providers:** OpenAI, Groq, Sarvam (configured in `src/llm/llm.yaml`)
- **PDF generation:** Puppeteer (system Chromium in Docker, local Chrome otherwise)
- **HTTP server:** Native Node.js `http` module (no Express/Fastify)
- **WhatsApp:** Meta Graph API v19.0
- **Mobile auth:** OTP via AWS SNS, JWT (access 1hr + refresh 30d)
- **Logging:** pino (structured JSON), Sentry for error monitoring

## Common Commands

```bash
# Local dev (requires postgres + redis running)
docker compose up -d postgres redis
pnpm prisma migrate deploy
pnpm dev:api          # API server with hot reload (tsx watch, port 3000)
pnpm dev:worker       # BullMQ worker with hot reload (tsx watch)

# Build & production
pnpm build            # tsc + copy templates/yaml to dist/
pnpm start:api        # node dist/api/server.js
pnpm start:worker     # node dist/worker/worker.js

# Database
pnpm prisma migrate dev       # Create/apply migrations in dev
pnpm prisma migrate deploy    # Apply pending migrations
pnpm prisma generate          # Regenerate Prisma Client
pnpm db:smoke                 # DB connectivity smoke test
pnpm db:wipe                  # Clear all data

# Full stack via Docker
docker compose up -d          # All services including ngrok for webhook tunneling
```

No test framework is currently configured.

## Architecture

**Two entry points:**
- `src/api/server.ts` — thin HTTP dispatcher: health check, CORS, routes to `webhook/` or `rest/`
- `src/worker/worker.ts` — BullMQ worker processing reply and summary generation jobs

**API structure (`src/api/`):**
- `webhook/whatsappHandler.ts` — all WhatsApp webhook logic (verification, message ingestion, button gates)
- `rest/router.ts` — REST dispatcher for `/api/v1/*`; see `src/api/CLAUDE.md` for endpoint details
- `common/` — shared utilities: `sendJSON`, `httpHelpers`, `errors`, `mask`

**Message flow:**
1. WhatsApp message arrives at `POST /webhooks/whatsapp`
2. Server validates signature, upserts User/Identity, stores Message
3. Any message starting with `/` is a **direct command** — bypasses batching entirely, enqueued to `replyQueue` with `mode: "command"`; see `src/commands/CLAUDE.md` for command routing details
4. Interactive button replies (summary type, summary range, check-in time selection) are intercepted before the text guard via Redis pending-key gates. Summary intents pass through a two-step gate: type (SessionBridge / Myself, lately) → range (7/15/30 days).
5. Regular text messages are batched in Redis (`replyBatch/state.ts`) with debounce (5s) and max-wait (15s)
6. When batch flushes, worker runs the reply pipeline (`llm/ackReply.ts`) — see `src/llm/CLAUDE.md` for full classification and routing details
7. If the decision includes `shouldGenerateSummary: true` or `shouldSetupCheckin: true`, the respective flow is triggered

**Message categories** (stored on `Message.category`):
- `user_message` — default journal entry
- `command_reply` — user sent a `/command`; filtered out of LLM context and chatlog
- `test_feedback` — internal test feedback; filtered everywhere
- `summary_request` — message that triggered a summary; excluded from report windows

**Key subsystems** (see `CLAUDE.md` in each directory for details):
- `src/commands/` — slash command handling: registry, router, one file per command under user/ and admin/
- `src/llm/` — LLM pipeline: classify/, reply/ack|greeting|guide/, context/, config, client
- `src/summary/` — multi-stage report pipeline with two report types: `sessionbridge/` (therapist brief) and `myself-lately/` (self-reflection mirror). Shared infra at top, per-report code in subfolders. PDF generation + Redis key helpers.
- `src/infra/` — shared services: encryption, Prisma, Redis, WhatsApp client, PDF, logger
- `src/queues/` — four BullMQ queues: summaryQueue, replyQueue, replyBatchQueue, reminderQueue
- `src/consent/` — YAML-configured consent gating flow
- `src/replyBatch/` — Redis-based message batching with atomic lock for flush
- `src/engagement/` — proactive messaging: checkin/ (reminders), nudge/ (inactivity), shared scheduler.ts

## Database

Prisma schema at `prisma/schema.prisma`. Config in `prisma.config.ts` (resolves DATABASE_URL or builds from DB_HOST/DB_USER/DB_PASSWORD/DB_NAME; auto-adds SSL for RDS).

**Models:** User → Identity (channel binding) → Message. Summary links to User. UserSettings (1-to-1 with User, created eagerly) holds per-user preferences: `timezone`, `lastNudgedAt`. UserReminder holds scheduled check-ins per user. RefreshToken stores hashed mobile app refresh tokens with revocation support.

**Identity channels:** `"whatsapp"` (WhatsApp users, gated by allowlist) and `"app"` (mobile app users, open sign-up). A user can have both. Message history queries use `userId` to span all channels.

**Key Message fields:**
- `category` — broad filter bucket: `user_message`, `command_reply`, `test_feedback`, `summary_request`
- `classifierType` — fine-grained LLM output: `journal_entry`, `greeting`, `trivial`, `closing`, `summary_request`, `guide_query`, `setup_checkin`; set on the latest message in each batch after reply generation; used for engagement scoring in `/userstats`

## Environment Variables

Required (WhatsApp): `DATABASE_URL` (or `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`), `REDIS_URL`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_PERMANENT_TOKEN`, `GROQ_API_KEY` (or `OPENAI_API_KEY`), `CONSENT_CONFIG_PATH`, `ENCRYPTION_MASTER_KEY`.

Required (REST/mobile): `JWT_SECRET`, `AWS_SNS_REGION` (default `ap-south-1`), AWS credentials (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` or IAM role).

Optional: `SENTRY_DSN`, `LOG_LEVEL` (default `info`), `CORS_ALLOWED_ORIGINS` (default `*`).

## Build Notes

- The build step copies non-TS assets to `dist/`: `src/llm/llm.yaml`, `src/summary/template/` (HTML, CSS, images), `src/summary/prompts/` (recursively, all `.md` prompt templates), `src/engagement/checkin/checkin.yaml`, `src/engagement/nudge/nudge.yaml`
- Prisma 7 uses `prisma.config.ts` for driver adapter configuration, not the standard `schema.prisma` generator block
- Docker image installs system Chromium; local dev needs `npx puppeteer browsers install chrome`

## Agent skills

### Issue tracker

GitHub Issues at `sanattune/mecove-backend` via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at repo root. See `docs/agents/domain.md`.

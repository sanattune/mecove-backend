# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

meCove is a WhatsApp-based journaling backend. It receives WhatsApp messages via Meta webhook, stores them in PostgreSQL, generates AI-powered acknowledgment replies, and produces periodic summary reports as PDFs.

## Tech Stack

- **Runtime:** Node.js 20, TypeScript (ES2022, CommonJS)
- **Package manager:** pnpm
- **Database:** PostgreSQL 16+ with Prisma 7 (using `@prisma/adapter-pg` native driver adapter)
- **Queue:** BullMQ on Redis 7+ (via ioredis)
- **LLM providers:** OpenAI, Groq, Sarvam (configured in `src/llm/llm.yaml`)
- **PDF generation:** Puppeteer (system Chromium in Docker, local Chrome otherwise)
- **HTTP server:** Native Node.js `http` module (no Express/Fastify)
- **WhatsApp:** Meta Graph API v19.0

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
- `src/api/server.ts` — HTTP server handling Meta webhook verification/delivery, health checks, and a debug endpoint
- `src/worker/worker.ts` — BullMQ worker processing reply and summary generation jobs

**Message flow:**
1. WhatsApp message arrives at `POST /webhooks/whatsapp`
2. Server validates signature, upserts User/Identity, stores Message
3. Messages are batched in Redis (`replyBatch/state.ts`) with debounce (5s) and max-wait (15s)
4. When batch flushes, worker runs the reply pipeline (`llm/ackReply.ts`) — see `src/llm/CLAUDE.md` for full classification and routing details
5. If the decision includes `shouldGenerateSummary: true`, a summary range prompt (buttons) is sent and a summary job is enqueued

**Key subsystems** (see `CLAUDE.md` in each directory for details):
- `src/llm/` — reply pipeline: classification, routing, LLM config
- `src/summary/` — multi-stage summary pipeline, PDF generation
- `src/infra/` — shared services: encryption, Prisma, Redis, WhatsApp client, PDF, logger
- `src/queues/` — three BullMQ queues: summaryQueue, replyQueue, replyBatchQueue
- `src/consent/` — YAML-configured consent gating flow
- `src/replyBatch/` — Redis-based message batching with atomic lock for flush

## Database

Prisma schema at `prisma/schema.prisma`. Config in `prisma.config.ts` (resolves DATABASE_URL or builds from DB_HOST/DB_USER/DB_PASSWORD/DB_NAME; auto-adds SSL for RDS).

**Models:** User → Identity (channel binding) → Message. Summary links to User.

## Environment Variables

Required: `DATABASE_URL` (or `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`), `REDIS_URL`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_PERMANENT_TOKEN`, `GROQ_API_KEY` (or `OPENAI_API_KEY`), `CONSENT_CONFIG_PATH`.

## Build Notes

- The build step copies non-TS assets to `dist/`: `src/llm/llm.yaml` and `src/summary/template/` (HTML, CSS, images)
- Prisma 7 uses `prisma.config.ts` for driver adapter configuration, not the standard `schema.prisma` generator block
- Docker image installs system Chromium; local dev needs `npx puppeteer browsers install chrome`

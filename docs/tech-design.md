# MeCove Backend — Technical Design

## 1. Overview

MeCove backend is a Node.js/TypeScript service that receives WhatsApp messages via Meta webhooks, stores them, generates conversational replies using an LLM (Groq), and optionally sends **contextual (threaded/bubbled)** replies when the conversation has moved on. It also enqueues summary-generation jobs for the last 7 days of messages.

---

## 2. Table Schema (Prisma / PostgreSQL)

### 2.1 Entity Relationship Summary

```
User 1───* Identity
User 1───* Message
User 1───* Summary
Identity 1───* Message
```

### 2.2 Tables (Models)

| Model      | Purpose |
|-----------|---------|
| **User**  | One per end-user; aggregates identities and messages. |
| **Identity** | One per channel + channel user (e.g. one WhatsApp number). Links to User. |
| **Message** | One per inbound message; stores text, reply metadata, and optional raw payload. |
| **Summary** | One per summary job run; stores range, status, summary text, input hash, and error. |

### 2.3 Detailed Schema

#### User
| Column     | Type     | Notes |
|-----------|----------|--------|
| id        | UUID     | PK, default uuid() |
| createdAt | DateTime | default now() |

- Relations: `identities`, `messages`, `summaries`.

#### Identity
| Column         | Type   | Notes |
|----------------|--------|--------|
| id             | UUID   | PK |
| userId         | UUID   | FK → User |
| channel        | String | e.g. `"whatsapp"` |
| channelUserKey | String | e.g. `"+919130099484"` |
| createdAt      | DateTime | default now() |

- **Unique:** `(channel, channelUserKey)` — one identity per channel + user key.
- Relations: `user`, `messages`.

#### Message
| Column          | Type     | Notes |
|-----------------|----------|--------|
| id              | UUID     | PK |
| userId          | UUID     | FK → User |
| identityId      | UUID     | FK → Identity |
| createdAt       | DateTime | server receive time |
| clientTimestamp | DateTime? | from WhatsApp |
| contentType     | String   | e.g. `"text"` |
| text            | String?  | message body |
| rawPayload      | Json?    | full webhook payload |
| sourceMessageId | String   | WhatsApp message id (e.g. `wamid.xxx`) |
| repliedAt       | DateTime? | when bot reply was sent |
| replyText       | String?  | text of the reply sent |

- **Unique:** `(identityId, sourceMessageId)` — dedupe by channel identity + WhatsApp id.
- **Indexes:** `(userId, createdAt)`, `(identityId, createdAt)`, `(userId, repliedAt)`.

#### Summary
| Column              | Type     | Notes |
|---------------------|----------|--------|
| id                  | UUID     | PK |
| userId              | UUID     | FK → User |
| rangeStart          | DateTime | range start |
| rangeEnd            | DateTime | range end |
| createdAt           | DateTime | default now() |
| status              | String   | e.g. `"success"` |
| summaryText         | String?  | generated summary |
| modelName           | String?  | optional |
| promptVersion       | String?  | optional |
| inputMessagesCount  | Int      | default 0 |
| inputHash           | String?  | hash of input (e.g. message ids + texts) |
| error               | String?  | if failed |

- **Index:** `(userId, rangeStart, rangeEnd)`.

---

## 3. Tech Stack

| Layer        | Technology |
|-------------|------------|
| Runtime     | Node.js ≥ 20 |
| Language    | TypeScript (CommonJS) |
| Package mgr | pnpm |
| DB          | PostgreSQL |
| ORM         | Prisma 7 (with `prisma.config.ts`, no `url` in schema; driver adapter) |
| DB driver   | `pg` + `@prisma/adapter-pg` |
| Queue       | BullMQ (Redis-backed) |
| Redis       | ioredis (shared connection) |
| LLM         | Groq API (config in `src/llm/llm.yaml`; env: `GROQ_API_KEY`) |
| WhatsApp    | Meta WhatsApp Business API (webhook + send message) |
| Config      | `dotenv` for env; YAML for LLM provider/model |

---

## 4. Patterns

- **Queue-based async processing**  
  Inbound work (reply generation, summary) is enqueued; API responds 200 quickly. Workers process jobs with retries (reply: 3 attempts, exponential backoff).

- **Fail-fast startup**  
  API and worker validate `REDIS_URL` and `DATABASE_URL` on startup and exit with a clear error if missing.

- **Shared infra**  
  Single Redis connection (`src/infra/redis.ts`), single Prisma client with PG adapter (`src/infra/prisma.ts`), shared logger (`src/infra/logger.ts`).

- **Contextual reply decision**  
  Reply is sent as a **standalone** message or as a **contextual (threaded)** reply based on:
  - **Messages-after rule:** If there are more than 1 message after this one (by server timestamp in Redis), send contextual.
  - **Stale rule:** If the response is sent more than 10 seconds after the message was received, send contextual.
  - Otherwise send standalone. When contextual, WhatsApp API is called with `context: { message_id: sourceMessageId }`.

- **Message tracking in Redis**  
  For “messages after” and staleness we use a Redis ZSET per user: key `messages:{userId}`, score = server timestamp (ms), value = internal message id. Entries older than 1 minute are removed on add and on count.

- **Idempotent message storage**  
  Messages are upserted by `(identityId, sourceMessageId)` so duplicate webhook deliveries do not create duplicate rows.

- **Graceful shutdown**  
  Worker closes BullMQ workers and disconnects Prisma on SIGTERM/SIGINT.

---

## 5. User Flow (Current)

### 5.1 WhatsApp Inbound Message (Happy Path)

1. **Webhook**  
   Meta sends `POST /webhooks/whatsapp` with the message payload.

2. **Validation**  
   - Only text messages are processed; others get 200 and no further action.
   - Extract: sender (`from`), `messageId`, `timestamp`, `textBody`.

3. **Identity resolution**  
   - Normalize phone to `channelUserKey` (e.g. `+919130099484`).
   - Look up `Identity` by `(channel: "whatsapp", channelUserKey)`.
   - If missing, create `User` and then `Identity` for that WhatsApp number.

4. **Message persistence**  
   - Compute `serverTimestamp = Date.now()` (used for Redis and job payload).
   - Upsert `Message` by `(identityId, sourceMessageId)`; store `text`, `clientTimestamp`, `rawPayload`, etc.

5. **Redis tracking**  
   - `addMessageTracking(user.id, message.id, serverTimestamp)` adds the message to the user’s ZSET for “messages after” and staleness.

6. **Enqueue jobs**  
   - Summary: `summaryQueue.add("generateSummary", { userId, range: "last_7_days" })`.
   - Reply: `replyQueue.add("generateReply", { userId, messageId, identityId, sourceMessageId, channelUserKey, messageText, messageTimestamp: serverTimestamp })`.

7. **Response**  
   - Respond 200 with `{ ok: true }`.

### 5.2 Reply Job (Worker)

1. **Job data**  
   Uses `userId`, `messageId`, `identityId`, `sourceMessageId`, `channelUserKey`, `messageText`, `messageTimestamp`.

2. **LLM reply**  
   - `generateAckReply(userId, messageText)` loads last 10 messages (with `replyText`/`repliedAt`), formats as alternating “User:” / “Bot:” lines, calls LLM (Groq) with a fixed prompt.
   - On failure or empty content, use fallback `"Noted."`.

3. **Contextual vs standalone**  
   - `messagesAfterCount = countMessagesAfter(userId, messageTimestamp)` (Redis ZSET, count entries with score > `messageTimestamp`).
   - `timeSinceMessage = Date.now() - messageTimestamp`; if `timeSinceMessage > 10_000` ms, consider stale.
   - **Contextual** if `messagesAfterCount > 1` OR `timeSinceMessage > 10_000`.
   - If contextual, pass `sourceMessageId` into WhatsApp send; otherwise send without context.

4. **Send**  
   - `sendWhatsAppReply(channelUserKey, replyText, contextualMessageId)` calls Meta API; for contextual, body includes `context: { message_id: sourceMessageId }`.

5. **Persist reply**  
   - Update `Message`: set `repliedAt = now()`, `replyText = replyText`.

### 5.3 Summary Job (Worker)

1. **Job data**  
   `userId`, `range: "last_7_days"`.

2. **Load messages**  
   Last 7 days for that user, ordered by `createdAt`.

3. **Create Summary row**  
   `rangeStart`, `rangeEnd`, `status: "success"`, `summaryText: "Summary generated for N messages."`, `inputMessagesCount`, `inputHash` (hash of message ids + texts).

### 5.4 Webhook Verification

- `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`  
- If `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`, respond with `hub.challenge` (plain text).

### 5.5 Debug Endpoint

- `POST /debug/enqueue-summary` (or GET): finds identity `(whatsapp, +10000000000)`, enqueues one `generateSummary` job, returns `{ ok: true, jobId }`.

---

## 6. Component Layout

```
src/
├── api/
│   └── server.ts          # HTTP server: health, webhook, debug
├── infra/
│   ├── logger.ts         # Structured logger
│   ├── prisma.ts         # PrismaClient + PG adapter
│   ├── redis.ts          # Shared ioredis connection
│   ├── messageTracking.ts # Redis ZSET add/count for “messages after”
│   └── whatsapp.ts        # sendWhatsAppReply (with optional context)
├── llm/
│   ├── ackReply.ts       # generateAckReply (last 10 msgs, User/Bot format, prompt)
│   ├── config.ts         # loadLLMConfig from llm.yaml
│   ├── llmViaApi.ts      # Groq completion
│   ├── llm.yaml          # Provider/model config
│   └── types.ts          # LLM types
├── queues/
│   ├── replyQueue.ts     # BullMQ "reply" queue, GenerateReplyPayload
│   └── summaryQueue.ts   # BullMQ "summary" queue, GenerateSummaryPayload
├── worker/
│   └── worker.ts         # Summary worker + Reply worker, shutdown
└── scripts/
    ├── db_smoke.ts       # DB connectivity smoke test
    └── check_reply_queue.ts # Reply queue diagnostics
```

---

## 7. External Integrations

| Integration | Purpose | Config / Notes |
|-------------|---------|----------------|
| **Meta WhatsApp** | Receive messages (webhook), send replies (REST) | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_PERMANENT_TOKEN`, `WHATSAPP_VERIFY_TOKEN`; webhook URL registered with Meta |
| **Groq** | LLM for ack replies | `GROQ_API_KEY`; model in `llm.yaml` (e.g. `openai/gpt-oss-20b`) |
| **PostgreSQL** | Persistence | `DATABASE_URL` |
| **Redis** | BullMQ + message tracking ZSETs | `REDIS_URL` |

---

## 8. Environment Variables (Summary)

| Variable | Required | Used by |
|----------|----------|--------|
| DATABASE_URL | Yes | API, Worker, Prisma |
| REDIS_URL | Yes | API, Worker, BullMQ, messageTracking |
| GROQ_API_KEY | For LLM | Worker (ackReply → llmViaApi) |
| WHATSAPP_PHONE_NUMBER_ID | For sending | Worker (whatsapp.ts) |
| WHATSAPP_PERMANENT_TOKEN | For sending | Worker (whatsapp.ts) |
| WHATSAPP_VERIFY_TOKEN | For webhook verify | API (GET /webhooks/whatsapp) |

---

This document reflects the design as of the current codebase (single-channel WhatsApp, reply + summary workers, contextual reply rules, and Redis-based message tracking).

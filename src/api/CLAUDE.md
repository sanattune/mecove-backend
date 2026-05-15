# API (`src/api/`)

## Structure

```
server.ts          — thin dispatcher: health, CORS, routes to webhook/ or rest/
webhook/           — WhatsApp webhook handling
rest/              — Mobile app REST API
common/            — Shared utilities used by both
```

## `server.ts`

Routes by path prefix:
- `/health` → deep check (DB + Redis), returns `{ status, timestamp, checks }`
- `/api/v1/*` → `rest/router.ts`
- `/webhooks/whatsapp` → `webhook/whatsappHandler.ts`
- `/debug/*` → `webhook/whatsappHandler.ts` (debug endpoints)

Also handles: CORS headers (`CORS_ALLOWED_ORIGINS` env var), OPTIONS preflight, graceful shutdown on SIGTERM/SIGINT (10s drain).

## `webhook/whatsappHandler.ts`

All WhatsApp logic extracted from the old monolithic server.ts. Exports:
- `handleWhatsAppVerification` — GET hub challenge
- `handleWhatsAppWebhook` — POST message ingestion (approval gate → consent gate → button gates → batching)
- `handleDebugConsentStatus`, `handleDebugEnqueueSummary` — debug endpoints

## `rest/` — Mobile App REST API

Base path: `/api/v1/`

### Auth endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/auth/request-otp` | Generate OTP, send via AWS SNS. Rate: 3/15min per phone. |
| POST | `/auth/verify` | Verify OTP, upsert User+Identity (channel=`"app"`), return JWT pair. |
| POST | `/auth/refresh` | Exchange valid refresh token for new access token. |
| POST | `/auth/logout` | Revoke refresh token (`revokedAt` set in DB). Requires Bearer auth. |

**Auth flow:** OTP stored in Redis (`otp:v1:{phone}`, 10min TTL). On verify, OTP consumed atomically. New users auto-created with `role="user"`, `approvedAt=now()`. WhatsApp allowlist does NOT apply to app sign-ups.

**Tokens:** Access JWT (1hr), refresh JWT (30d). Refresh tokens stored as SHA-256 hashes in `RefreshToken` table. `JWT_SECRET` env var required.

### Message endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/messages` | Paginated history. Cursor: `?before=<ISO timestamp>&limit=50`. Returns `user_message` + `summary_request` categories across all channels. |
| POST | `/messages/send` | Send message, get AI reply synchronously (30s timeout). Rate: 20/min per user. |

**Message send flow:** Store message with `channel="app"` Identity → call `generateAckDecision()` directly (no queue) → store reply → return both in response. App waits for reply in the same HTTP response.

### Planned endpoints (in scope, not yet implemented)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/summary/generate` | Generate report (type + range in body) |
| GET | `/api/v1/checkin` | Current reminder status |
| POST | `/api/v1/checkin/setup` | Set/update/turn off reminder |
| GET | `/api/v1/stats` | User stats (message count, join date, last report) |
| DELETE | `/api/v1/account/data` | Clear all messages and summaries |
| GET | `/api/v1/privacy` | Privacy notice text |

**Encryption:** Messages encrypted/decrypted with user's DEK via `getOrCreateUserDek()`. History endpoint decrypts before returning. `decryptText()` is safe on non-encrypted strings.

### Middleware

- `rest/middleware/auth.ts` — `requireAuth()` verifies Bearer JWT, attaches `userId` to request
- `rest/middleware/rateLimit.ts` — Redis sliding window via `checkRateLimit(key, limit, windowSeconds)`

### Request logging

Every REST request gets a `requestId` (UUID) attached as `X-Request-Id` response header. All handler logs use `childLogger({ requestId })` for traceability. Method, route, status, and duration logged on every request.

## `common/`

- `sendJSON.ts`, `sendText.ts` — response helpers
- `httpHelpers.ts` — `parseQuery()`, `readBody()` — shared by webhook and REST handlers
- `errors.ts` — standard error shapes (use `Errors.validation()`, `Errors.unauthorized()`, etc.)
- `mask.ts` — `maskPhone()` (last 4 digits), `maskToken()` — use in all log statements
- `httpTypes.ts` — `AuthenticatedRequest` type (extends IncomingMessage with `userId`, `requestId`)

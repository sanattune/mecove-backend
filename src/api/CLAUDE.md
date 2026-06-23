# API (`src/api/`)

## Structure

```
server.ts          — thin dispatcher: health, CORS, routes to webhook/ or rest/
webhook/           — WhatsApp webhook handling
rest/              — Mobile app REST API
common/            — Shared utilities used by both
```

## `server.ts`

Fastify v5 app. Registers:
- `@fastify/cors` — `CORS_ALLOWED_ORIGINS` env var (default `*`)
- `@fastify/swagger` + `@fastify/swagger-ui` — OpenAPI spec at `/api/docs/json`, Swagger UI at `/api/docs`
- `/health` route — deep check (DB + Redis), returns `{ status, timestamp, checks }`
- `restPlugin` at `/api/v1` — all REST routes
- WA webhook plugin (encapsulated) — `/webhooks/whatsapp`, `/debug/*`

WA webhook plugin uses `addContentTypeParser('application/json', { parseAs: 'string' })` to capture raw body before Fastify parses it, stores it on `req._rawBodyStr`. Encapsulation ensures this parser doesn't affect REST routes.

Graceful shutdown on SIGTERM/SIGINT (10s drain timeout).

## `webhook/whatsappHandler.ts`

All WhatsApp logic extracted from the old monolithic server.ts. Exports:
- `handleWhatsAppVerification` — GET hub challenge
- `handleWhatsAppWebhook` — POST message ingestion (approval gate → consent gate → button gates → batching)
- `handleDebugConsentStatus`, `handleDebugEnqueueInsight` — debug endpoints

## `rest/` — Mobile App REST API

Implemented as a Fastify plugin (`restPlugin` in `router.ts`). Base path: `/api/v1/`.

Routes are declared in `router.ts` with inline JSON Schema (`schema:`) for OpenAPI docs, and `onRequest: [authenticate]` for protected routes. Handlers are pure `async (request, reply)` functions in `handlers/`.

`restPlugin` registers a custom JSON content-type parser that accepts empty bodies (returns `{}`). This handles Android clients that send `Content-Type: application/json` on no-payload POSTs. The WA webhook plugin has its own encapsulated override and is unaffected.

Auth: `authenticate` in `rest/middleware/auth.ts` is a Fastify `onRequest` hook — verifies Bearer JWT, sets `request.userId`. Rate limiting is done inside handlers (uses `checkRateLimit` from `middleware/rateLimit.ts`).

Request IDs: Fastify generates UUIDs via `genReqId`. Every response gets `X-Request-Id` header via `onRequest` hook. Handlers use `childLogger({ requestId: request.id })` for structured logging.

### Auth endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/auth/request-otp` | Generate OTP, send via AWS SNS. Rate: 3/15min per phone. |
| POST | `/auth/verify` | Verify OTP, upsert User+Identity (channel=`"app"`), return JWT pair. |
| POST | `/auth/refresh` | Exchange valid refresh token for new access token. |
| POST | `/auth/logout` | Revoke refresh token (`revokedAt` set in DB). Requires Bearer auth. |

**Auth flow:** OTP stored in Redis (`otp:v1:{phone}`, 10min TTL). On verify, OTP consumed atomically. New users auto-created with `role="user"`, `approvedAt=now()`. WhatsApp allowlist does NOT apply to app sign-ups.

**Tokens:** Access JWT (1hr), refresh JWT (30d). Refresh tokens stored as SHA-256 hashes in `RefreshToken` table. `JWT_SECRET` env var required.

**`/auth/verify` response includes `privacyAccepted: boolean`** — `true` if user's `privacyAcceptedVersion` matches `consentConfig.mvp.version`. App uses this to gate Chat at login time.

### Message endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/messages` | Paginated history. Cursor: `?before=<ISO timestamp>&limit=50`. Returns `user_message` + `summary_request` categories across all channels. |
| POST | `/messages/send` | Send message, get AI reply synchronously (30s timeout). Rate: 20/min per user. |

**Message send flow:** Store message with `channel="app"` Identity → call `generateAckDecision()` directly (no queue) → store reply → return both in response. App waits for reply in the same HTTP response.

### Insight endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/insights/generate` | Enqueue insight (body: `{type, range}`). Returns `{insightId, status: "queued"}`. One in-flight per user (409 if busy). |
| GET | `/insights/:insightId` | Poll status: `queued → processing → success \| success_fallback \| failed`. Returns `{id, status, insightType, rangeStart, rangeEnd, createdAt}`. |
| GET | `/insights/:insightId/pdf` | Download PDF bytes. Only available when status is success/success_fallback. |

### Checkin endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/checkin` | Returns `{active, time, label}` for active reminder, or `{active: false}`. |
| POST | `/checkin/setup` | Body: `{time: "06:00"\|"16:00"\|"21:00"\|"off"}`. Sets or turns off daily reminder. |

### Account endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/stats` | Returns `{messageCount, memberSince, lastInsight: {type, createdAt} \| null}`. |
| DELETE | `/account/data` | Permanently deletes all messages and insights for the user. |
| GET | `/privacy` | Returns `{message, link, privacyAccepted}`. Does DB fetch — `privacyAccepted` is version-checked against `consentConfig.mvp.version`. App calls this on every open when user is already logged in. |
| POST | `/privacy/accept` | Records consent: sets `privacyAcceptedAt` (now) + `privacyAcceptedVersion` (from consent config) on user. Idempotent. Returns `{success: true}`. |

**Privacy gate:** `privacyAccepted` is a version check (`user.privacyAcceptedVersion === consentConfig.mvp.version`), not just non-null. Bumping `mvp.version` in `consent.config.yaml` forces re-acceptance for all users.

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

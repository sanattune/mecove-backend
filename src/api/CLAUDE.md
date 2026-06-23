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
| POST | `/auth/request-otp` | Generate OTP, send via WhatsApp `mecove_otp` template (ADR-0005). Rate: 3/15min per phone. |
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
| DELETE | `/account/data` | **Messages-only** (D25): deletes the user's chat messages; insights are retained (so professional-support engagements/shares stay valid). Privacy note: plaintext insights survive an erase (D22b). |
| GET | `/privacy` | Returns `{message, link, privacyAccepted}`. Does DB fetch — `privacyAccepted` is version-checked against `consentConfig.mvp.version`. App calls this on every open when user is already logged in. |
| POST | `/privacy/accept` | Records consent: sets `privacyAcceptedAt` (now) + `privacyAcceptedVersion` (from consent config) on user. Idempotent. Returns `{success: true}`. |

**Privacy gate:** `privacyAccepted` is a version check (`user.privacyAcceptedVersion === consentConfig.mvp.version`), not just non-null. Bumping `mvp.version` in `consent.config.yaml` forces re-acceptance for all users.

### Professional endpoints (professional-support)

Handlers in `handlers/professionalHandler.ts`. See `docs/plans/plan_professional-support.md`.

| Method | Path | Description |
|---|---|---|
| POST | `/professional/profiles` | Self-serve onboarding. Body `{professionalType: therapist\|counsellor\|coach, displayName, additionalTitle?}`. Creates a `ProfessionalProfile` and sets `User.isProfessional=true` (one txn). Active immediately; `verificationStatus='pending'`. Returns 201 with the profile. A user may hold several profiles (1:N). |
| GET | `/professional/profiles` | Returns `{profiles: [...]}` — the caller's own profiles (empty if none). |
| POST | `/professional/engagements` | Pro opens an engagement (`engagementHandler.ts`). Body `{professionalId, clientPhone (E.164), startDate?, endDate?}`. Matches `clientPhone` against `Identity.channelUserKey`: account exists → **add** (`clientUserId` set); none → **invite** (`inviteePhone` set, reconciled on signup). Always `status='pending'`. 409 on a duplicate pending/active pair (D24); 404 if `professionalId` isn't the caller's; 403 if not a professional. |
| GET | `/professional/engagements` | `{engagements: [...]}` across the caller's profiles, newest first; includes linked client `{userId, phone, displayName}` once attached. |

`/professional/*` routes use `onRequest: [authenticate, requireProfessional]` — the latter (in `middleware/auth.ts`) 403s callers without `User.isProfessional`; per-profile ownership is checked in the handler against the specific `professionalId`.

### Engagement endpoints (client side)

Same `engagementHandler.ts`; `authenticate` only (these are the client's own).

| Method | Path | Description |
|---|---|---|
| GET | `/engagements` | `{engagements: [...]}` — the caller's engagements as a client (pending/active/ended), each with the professional's `{displayName, professionalType, additionalTitle, verificationStatus}`. |
| POST | `/engagements/:engagementId/accept` | Consent gate (D5): pending→active, sets `acceptedAt`. 404 if not the caller's; 409 if not pending or an active engagement with that professional already exists (partial-unique P2002). |
| POST | `/engagements/:engagementId/end` | Client ends (D11), from pending (decline) or active → `ended`/`endedBy=client`. 409 if already ended. Professional's access cut by derivation. |
| POST | `/professional/engagements/:engagementId/end` | Professional ends → `ended`/`endedBy=professional`. (Pro-side route; `requireProfessional`.) |

**Expiry:** a daily reminder-queue job (`JOB_NAME_SCAN_ENGAGEMENT_EXPIRY`, 00:30 UTC) runs `src/professional/lifecycle.ts#expireDueEngagements` — active engagements past `endDate` → `ended`/`endedBy=expiry`. Registered via `startEngagementExpiryScheduler`, dispatched in the `reminderWorker`.

**Invite reconciliation:** `/auth/verify` calls `reconcileEngagementInvites(userId, phone)` after resolving the user — links any pending invite where `inviteePhone == phone` (sets `clientUserId`, nulls `inviteePhone`). Idempotent; matches only unlinked pending rows (D26).

### Insight sharing (professional-support, `shareHandler.ts`)

Client-controlled disclosure. Mutations route through `src/professional/sharing.ts` (shared with the worker's auto-send).

| Method | Path | Description |
|---|---|---|
| POST | `/engagements/:engagementId/shares` | Client shares an own insight (any type) with an **active** engagement. Guards: engagement is the caller's + active (409 if not), insight is the caller's (404) + ready `success`/`success_fallback` (409). Re-sharing a revoked insight reactivates it (upsert). |
| DELETE | `/engagements/:engagementId/shares/:insightId` | Unshare — sets `revokedAt` (D12). Idempotent; 404 if no such share. |
| PUT | `/engagements/:engagementId/auto-send` | Body `{enabled}`. Toggles `autoSendSessionBridge`; affects **future** SessionBridge insights only. 409 if engagement ended. |
| GET | `/professional/engagements/:engagementId/insights` | Pro reads shared insights (metadata only). **Access derived**: returns `[]` unless the engagement is active; lists only non-revoked shares (D23). |
| GET | `/professional/engagements/:engagementId/insights/:insightId/pdf` | Pro downloads a shared insight PDF, gated by the same derived access. |

**Auto-send (D28):** the worker calls `autoShareSessionBridgeInsight(insightId, userId)` after a SessionBridge insight reaches `success`, sharing it (autoSent=true) to every active engagement with the toggle on. Non-fatal — a sharing failure never fails the generation job.

### Admin endpoints (`adminHandler.ts`)

Team-only. `onRequest: [authenticate, requireAdmin]` (`requireAdmin` 403s callers whose `User.role !== "admin"`).

| Method | Path | Description |
|---|---|---|
| GET | `/admin/professional-profiles` | Review queue. Optional `?status=pending\|verified\|rejected`. Returns profiles + owner `{phone, displayName}`. |
| PATCH | `/admin/professional-profiles/:profileId/verification` | Set `verificationStatus` (async trust badge, D15 — non-blocking; client-accept is the real gate). Already surfaced on every profile read. |

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

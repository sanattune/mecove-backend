# Infrastructure (`src/infra/`)

Shared services used across the codebase.

## Encryption (`encryption.ts` + `userDek.ts`)

Per-user AES-256-GCM with KEK-wrapped DEKs.

- **KEK** (Key Encryption Key): from `ENCRYPTION_MASTER_KEY` env var (64 hex chars). Validated at startup.
- **DEK** (Data Encryption Key): per-user 32-byte key, stored encrypted in `User.encryptedDek`.
- **Encrypted format**: `enc:v1:<iv_hex>:<ciphertext_hex>:<tag_hex>`
- `decryptText()` passes through non-encrypted strings (migration compatibility)
- `getOrCreateUserDek(userId)` — fetches or creates DEK for a user

## Database (`prisma.ts`)

Singleton Prisma client. Builds connection URL from `DATABASE_URL` or individual `DB_*` vars. Auto-configures SSL for RDS. Uses `@prisma/adapter-pg` native driver adapter.

## Redis (`redis.ts`)

Lazy-initialized ioredis client from `REDIS_URL`. Access via `getRedis()`.

## WhatsApp (`whatsapp.ts`)

Cloud API client (Graph API v19.0). Exports:
- `sendWhatsAppReply()` — plain text (free-form; only deliverable in 24h CS window)
- `sendWhatsAppButtons()` — 1-3 reply buttons
- `sendWhatsAppDocument()` — PDF (media upload + send)
- `sendWhatsAppTypingIndicator()`
- `sendWhatsAppTemplate(toDigits, name, lang, components)` — pre-approved template message; reaches cold numbers (used by OTP, professional invites)
- `WHATSAPP_TEMPLATES` — constant map of approved template name+lang (`otp`, `proInvite`). Names are immutable in Meta and identical across envs, so they're constants here (env override accepted but not required).

## PDF (`pdf.ts`)

`renderHtmlToPdf(html)` — headless Puppeteer, A4 format. Respects `PUPPETEER_EXECUTABLE_PATH` for containers.

## Logger (`logger.ts`)

Pino-based structured JSON logger. Exports `logger` and `childLogger(context)` for request-scoped logging. Backwards-compatible with the old `(message, context)` call order — normalises to pino's `(context, message)` internally. `LOG_LEVEL` env var (default `info`); dev mode uses `pino-pretty`.

## OTP (`otp.ts`)

OTP for mobile auth. `generateOtp()` → 6-digit code. `storeOtp()` / `verifyAndConsumeOtp()` use Redis with 10-minute TTL. `sendOtpWhatsApp()` delivers the code via the approved `mecove_otp` WhatsApp authentication template (copy-code button; OTP appears in both body + button params). **No SMS fallback** — AWS SNS removed, non-WhatsApp numbers can't receive a code (ADR-0005). Phone is normalized to bare digits for the Graph API `to` field; the Redis key keeps the full E.164. Dev: `OTP_DEV_MODE=true` logs the code and skips the real send.

## Sentry (`sentry.ts`)

`initSentry()` — call at startup (no-op if `SENTRY_DSN` unset). `captureException(err, context?)` — report errors with optional structured context.

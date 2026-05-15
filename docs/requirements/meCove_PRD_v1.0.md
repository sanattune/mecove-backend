# meCove - Product Requirements Document
**Native Mobile Apps | MVP v1.0**  
Version: 1.0 | Last Updated: May 15, 2026 | Status: Updated to Current Backend

---

> "A Safe Space For Your Thoughts."
>
> meCove is a private digital space where users can share thoughts, emotions, confusion, doubts, and daily experiences freely and safely. This document started as the input PRD for the mobile app, and has now been back-updated to match the backend APIs and architecture that were actually built.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Target Users](#2-target-users)
3. [MVP Scope](#3-mvp-scope)
4. [Technical Stack](#4-technical-stack)
5. [App Architecture & Screens](#5-app-architecture--screens)
6. [Backend Requirements and Implemented API](#6-backend-requirements-and-implemented-api)
7. [OTP and Auth Infrastructure](#7-otp-and-auth-infrastructure)
8. [Build & Delivery Plan](#8-build--delivery-plan)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Future Roadmap](#10-future-roadmap-post-mvp)
11. [Open Items](#11-open-items--decisions-pending)
12. [Glossary](#appendix-glossary)

---

## 1. Product Overview

### 1.1 Vision

meCove is a private, judgment-free digital space where users can share thoughts, emotions, confusion, doubts, and daily experiences. The app begins as a simple, warm chat interface and evolves into a personal growth companion supporting reflection reports, check-ins, coaching connections, goal setting, and emotional awareness over time.

### 1.2 Mission for MVP

Deliver a clean, trustworthy native mobile chat experience that continues the familiar safety of the existing WhatsApp-based meCove interaction, but in a dedicated branded mobile experience.

### 1.3 Core Positioning

| Dimension | Description |
|---|---|
| What it is | A private digital safe space for honest, unfiltered self-expression |
| What it is not | A therapy app, diagnosis tool, or forced positivity platform |
| Primary interaction | Conversational: user types freely, AI responds with presence rather than advice |
| Unique differentiator | No emotional labeling, no mandatory positivity, no automated diagnosis |
| Future layer | SessionBridge reports, Myself Lately reports, habit tracking, goal setting, coach connection |

---

## 2. Target Users

The first target users are people already familiar with the WhatsApp-based meCove experience. The backend also now supports direct app sign-up with a phone number, so the app can serve both existing WhatsApp users and new app-first users.

### 2.1 User Profiles

| User Type | Description |
|---|---|
| Therapy/coaching users | People in active sessions who use meCove to prepare or process between sessions |
| Professionals | People carrying mental load who need a private outlet without professional consequences |
| Students | People navigating emotional stress with no judgment |
| General users | Anyone who needs a safe space to think out loud |

### 2.2 Key User Needs

- A safe, private space to express freely without fear of judgment
- Continuity from WhatsApp where a phone-number identity already exists
- Simple phone OTP sign-in without passwords
- Minimal friction between opening the app and expressing
- Trust that the app is calm, human, secure, and not diagnostic

---

## 3. MVP Scope

### 3.1 In Scope - MVP v1.0

| Feature | Current Requirement |
|---|---|
| Native Android app | Build a separate Android app using Kotlin. UI may use Jetpack Compose unless the app team decides otherwise. |
| Native iOS app | Build a separate iOS app using Swift. UI may use SwiftUI unless the app team decides otherwise. |
| Phone OTP authentication | Backend-owned OTP flow. App requests OTP from meCove backend; backend sends SMS through AWS SNS; app verifies OTP with backend. |
| User identity | Backend matches phone number to an existing identity where possible. If none exists, current implementation creates a new app user and app identity. |
| Token session | Backend returns short-lived access token and long-lived refresh token. Apps store tokens securely using platform keychain/keystore APIs. |
| Chat interface | Clean, minimal chat UI. User sends messages and receives AI responses from the existing meCove AI reply pipeline. |
| Message history | Display prior conversation history loaded from meCove backend after login. |
| Shared API contract | Android and iOS consume the same REST API under `/api/v1`. |
| WhatsApp coexistence | Existing WhatsApp webhook channel remains supported by the backend. Mobile app is an additional channel, not a replacement in this backend version. |

### 3.2 Out of Scope - MVP v1.0

- Cross-platform React Native / Expo implementation
- Firebase Phone Auth
- Payments or subscriptions
- Social or community features
- Push notifications
- Coach-facing app
- In-app report generation, check-in, and account management UI (backend APIs are complete; mobile UI implementation is out of scope for initial chat-focused MVP)
- Full habit tracker, goal tracker, and idea capture experiences

> Note: Backend APIs for reports, check-in, account stats, data deletion, and privacy are fully implemented. Mobile UI for these features is deferred to the next phase; chat, auth, and history are the MVP focus.

---

## 4. Technical Stack

### 4.1 Mobile Apps

| Layer | Android | iOS |
|---|---|---|
| Language | Kotlin | Swift |
| UI | Jetpack Compose recommended | SwiftUI recommended |
| Networking | OkHttp/Retrofit or Ktor Client | URLSession or Alamofire |
| Secure storage | Android Keystore / EncryptedSharedPreferences | Keychain |
| Build tooling | Gradle / Android Studio | Xcode |
| Release channel | Play Store internal testing first | TestFlight first |

### 4.2 Backend

| Layer | Current Choice |
|---|---|
| Runtime | Node.js 20+ |
| Language | TypeScript |
| HTTP server | Fastify v5 (`@fastify/cors`, `@fastify/swagger`, `@fastify/swagger-ui`) |
| API base path | `/api/v1` for mobile REST APIs |
| Database | PostgreSQL via Prisma |
| Cache / queue | Redis, BullMQ |
| OTP delivery | AWS SNS SMS |
| Authentication | Backend OTP verification + JWT access/refresh tokens |
| AI replies | Existing meCove LLM acknowledgement reply pipeline |
| Message privacy | Per-user DEK encryption with KEK-wrapped DEKs |
| Logging | Pino structured logs with request IDs |
| Error tracking | Optional Sentry integration |
| Existing channel | WhatsApp Business API webhooks remain active |

### 4.3 Design System

Android and iOS should maintain equivalent design tokens, but implemented natively per platform.

| Token Category | Examples |
|---|---|
| Colors | primary, background, surface, text, textMuted, border, error, success |
| Typography | body, caption, title, display, weights |
| Spacing | xs, sm, md, lg, xl |
| Radius | sm, md, lg, full |
| Motion | typing indicator, screen transition, retry feedback |

No hardcoded visual values should be scattered across screens. Each platform should centralize visual constants in its own native theme layer.

---

## 5. App Architecture & Screens

### 5.1 Navigation Flow

| Screen | Purpose |
|---|---|
| Splash / Launch Screen | App branding, startup health/session check, redirect to auth or chat |
| Phone Entry Screen | User enters phone number in E.164 format, for example `+919876543210` |
| OTP Verification Screen | User enters 6-digit OTP received by SMS |
| Chat Screen | Full chat interface: history, text input, send button, AI responses |

### 5.2 Authentication Flow

1. User opens app.
2. App checks for stored access/refresh tokens.
3. If no session exists, user enters phone number.
4. App calls `POST /api/v1/auth/request-otp`.
5. Backend generates 6-digit OTP, stores it in Redis for 10 minutes, and sends SMS via AWS SNS.
6. User enters OTP.
7. App calls `POST /api/v1/auth/verify`.
8. Backend verifies and consumes OTP.
9. Backend finds an existing identity with the phone number where possible; otherwise it currently creates a new user with `role="user"` and `approvedAt=now`.
10. Backend returns `accessToken`, `refreshToken`, and `userId`.
11. App stores tokens securely and loads chat history.
12. When access token expires, app calls `POST /api/v1/auth/refresh`.
13. On logout, app calls `POST /api/v1/auth/logout` and removes local tokens.

### 5.3 Chat Screen Requirements

- Message bubbles: user messages right-aligned, assistant responses left-aligned
- Timestamps visible on messages
- Auto-scroll to latest message on load and after sending
- Text input fixed at bottom and keyboard-aware
- Send button active only when input is non-empty
- Loading/typing indicator while waiting for backend response
- Message history loaded on screen entry using pagination
- Retry option if send fails
- Friendly error state for expired session, network loss, rate limit, and reply timeout

---

## 6. Backend Requirements and Implemented API

The backend now exposes a mobile REST API under `/api/v1`, while keeping WhatsApp webhook support under `/webhooks/whatsapp`.

### 6.1 Current Backend State

- Backend hosted on AWS-compatible infrastructure.
- API server listens on port `3000` in the current implementation using Fastify v5.
- `/health` performs a deep DB and Redis health check.
- Mobile REST API is available under `/api/v1`.
- WhatsApp webhook endpoints remain available under `/webhooks/whatsapp`.
- Messages are stored in PostgreSQL and encrypted per user.
- Message replies are generated synchronously for the mobile app using the existing acknowledgement reply pipeline.
- Summary/report generation is fully implemented: app triggers generation via REST, PDF is stored on the DB, polled by app, and downloaded in one request.
- Check-in reminders, account stats, data deletion, and privacy endpoints are implemented.
- Interactive API docs (Swagger UI) are served at `/api/docs`.

### 6.2 Implemented Mobile API Endpoints

#### 6.2.1 Health Check

| | |
|---|---|
| Method | `GET` or `HEAD` |
| Endpoint | `/health` |
| Purpose | Verify API, database, and Redis availability |
| Auth | None |
| Success Response | `{ "status": "ok", "timestamp": string, "checks": { "db": "ok", "redis": "ok" } }` |
| Degraded Response | HTTP `503`, `{ "status": "degraded", "timestamp": string, "checks": { ... } }` |

#### 6.2.2 Request OTP

| | |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/auth/request-otp` |
| Purpose | Generate and send a 6-digit OTP by SMS |
| Auth | None |
| Request Body | `{ "phoneNumber": "+919876543210" }` |
| Success Response | `{ "success": true }` |
| Validation | `phoneNumber` must be E.164 format |
| Rate Limit | 3 requests per 15 minutes per phone number |
| Notes | OTP is stored in Redis for 10 minutes and sent through AWS SNS. |

#### 6.2.3 Verify OTP

| | |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/auth/verify` |
| Purpose | Verify OTP and return app session tokens |
| Auth | None |
| Request Body | `{ "phoneNumber": "+919876543210", "otp": "123456" }` |
| Success Response | `{ "accessToken": string, "refreshToken": string, "userId": string }` |
| Rate Limit | 10 attempts per 15 minutes per phone number |
| Error Cases | `INVALID_OTP`, `VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR` |
| Notes | OTP is consumed after successful verification. Current implementation creates a new app user if no existing identity is found. |

#### 6.2.4 Refresh Access Token

| | |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/auth/refresh` |
| Purpose | Exchange valid refresh token for a new access token |
| Auth | None; refresh token is supplied in body |
| Request Body | `{ "refreshToken": string }` |
| Success Response | `{ "accessToken": string }` |
| Error Cases | `UNAUTHORIZED`, `VALIDATION_ERROR`, `INTERNAL_ERROR` |
| Notes | Refresh tokens are JWTs, stored server-side as SHA-256 hashes, and expire after 30 days. |

#### 6.2.5 Logout

| | |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/auth/logout` |
| Purpose | Revoke a refresh token |
| Auth | Bearer access token required |
| Request Body | `{ "refreshToken": string }` |
| Success Response | `{ "success": true }` |
| Notes | Server sets `revokedAt` on the matching refresh token. App must also clear local secure storage. |

#### 6.2.6 Get Message History

| | |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/messages?limit=50&before=<ISO timestamp>` |
| Purpose | Load paginated conversation history for authenticated user |
| Auth | Bearer access token required |
| Success Response | `{ "messages": [{ "id": string, "role": "user" \| "assistant", "content": string, "timestamp": string }], "hasMore": boolean }` |
| Pagination | `limit` defaults to 50; max 100. `before` filters messages created before the supplied timestamp. |
| Ordering | Backend fetches newest rows first, then returns message items in chronological order for display. |
| Notes | Returns `user_message` and `summary_request` categories. History may include messages from multiple identities/channels for the same user. |

#### 6.2.7 Send Message

| | |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/messages/send` |
| Purpose | Store user message and return AI assistant reply |
| Auth | Bearer access token required |
| Request Body | `{ "content": string }` |
| Validation | `content` length must be 1 to 10,000 characters |
| Success Response | `{ "userMessage": { "id": string, "role": "user", "content": string, "timestamp": string }, "assistantMessage": { "id": string, "role": "assistant", "content": string, "timestamp": string } }` |
| Rate Limit | 20 messages per minute per user |
| Timeout | 30 seconds for AI reply generation |
| Error Cases | `REPLY_TIMEOUT`, `UNAUTHORIZED`, `VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR` |
| Notes | The mobile app waits for the assistant reply in the same HTTP response. Streaming/WebSockets are not part of MVP. |

#### 6.2.8 Generate Report

| | |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/summary/generate` |
| Purpose | Enqueue a report generation job |
| Auth | Bearer access token required |
| Request Body | `{ "type": "sessionbridge" \| "myself_lately", "range": "last_7_days" \| "last_15_days" \| "last_30_days" }` |
| Success Response | `{ "summaryId": string, "status": "queued" }` — HTTP 202 |
| Error Cases | `CONFLICT` if a report is already in progress, `UNAUTHORIZED`, `VALIDATION_ERROR` |
| Notes | One report per user at a time (15-minute lock). Poll with `GET /summary/:id` for status. |

#### 6.2.9 Get Report Status

| | |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/summary/:summaryId` |
| Purpose | Poll report progress |
| Auth | Bearer access token required |
| Success Response | `{ "id": string, "status": "queued" \| "processing" \| "success" \| "success_fallback" \| "failed", "reportType": string, "rangeStart": string, "rangeEnd": string, "createdAt": string }` |
| Notes | Poll until status is `success` or `success_fallback`, then download PDF. |

#### 6.2.10 Download Report PDF

| | |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/summary/:summaryId/pdf` |
| Purpose | Download generated PDF bytes |
| Auth | Bearer access token required |
| Success Response | Binary PDF, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="<type>-<date>.pdf"` |
| Error Cases | `NOT_FOUND` if report is not ready or not found |

#### 6.2.11 Get Check-in Reminder

| | |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/checkin` |
| Purpose | Get active daily reminder state |
| Auth | Bearer access token required |
| Success Response | `{ "active": true, "time": "06:00" \| "16:00" \| "21:00", "label": string }` or `{ "active": false, "time": null, "label": null }` |

#### 6.2.12 Set Check-in Reminder

| | |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/checkin/setup` |
| Purpose | Set or disable daily reminder |
| Auth | Bearer access token required |
| Request Body | `{ "time": "06:00" \| "16:00" \| "21:00" \| "off" }` |
| Success Response | `{ "active": boolean, "time": string \| null, "label": string \| null }` |
| Notes | `"off"` disables the reminder. Enabled reminders fire daily at the chosen time (Asia/Kolkata). |

#### 6.2.13 Get User Stats

| | |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/stats` |
| Purpose | Summary stats for the user profile screen |
| Auth | Bearer access token required |
| Success Response | `{ "messageCount": number, "memberSince": string \| null, "lastReport": { "type": string, "createdAt": string } \| null }` |

#### 6.2.14 Delete Account Data

| | |
|---|---|
| Method | `DELETE` |
| Endpoint | `/api/v1/account/data` |
| Purpose | Permanently delete all messages, reports, and associated Redis state for the user |
| Auth | Bearer access token required |
| Success Response | `{ "success": true }` |
| Notes | **Irreversible.** Does not delete the user account or revoke tokens — only messages and reports. |

#### 6.2.15 Get Privacy Notice

| | |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/privacy` |
| Purpose | Return the consent/privacy message for the privacy screen |
| Auth | Bearer access token required |
| Success Response | `{ "message": string, "link": string \| null }` |

### 6.3 Existing Non-Mobile Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/webhooks/whatsapp` | WhatsApp webhook verification |
| `POST` | `/webhooks/whatsapp` | WhatsApp message ingestion |
| `GET` | `/debug/consent-status` | Debug consent state |
| `GET` or `POST` | `/debug/enqueue-summary` | Debug enqueue summary job |

Debug endpoints are not mobile-app product APIs and should not be used by Android or iOS clients.

### 6.4 Auth and Security Requirements

- All production API calls must use HTTPS.
- All `/api/v1/messages/*` endpoints require `Authorization: Bearer <accessToken>`.
- `POST /api/v1/auth/logout` requires a valid access token and refresh token body.
- Access tokens expire after 1 hour.
- Refresh tokens expire after 30 days and are stored in the DB as SHA-256 hashes.
- Apps must store tokens only in platform secure storage.
- OTP must never be logged in plaintext.
- Phone numbers in logs must be masked.
- Rate limits must remain enabled for OTP and send-message endpoints.
- CORS is controlled by `CORS_ALLOWED_ORIGINS`; mobile apps are not browser origins, but this remains relevant for any web tooling.
- `X-Request-Id` response header must be captured in app error logs where practical.

### 6.5 Backend Implementation Notes

| Area | Current Behavior |
|---|---|
| OTP | `otp:v1:{phone}` Redis key, 10-minute TTL |
| SMS | AWS SNS, default region `ap-south-1` |
| India SMS | DLT/TRAI registration may be required before reliable delivery to Indian numbers |
| User creation | App OTP verification currently creates a user if no phone identity exists |
| Identity | Existing phone identity is reused where found; app identities use channel `app` |
| Message encryption | User messages and replies are encrypted with a per-user DEK |
| Reply generation | `generateAckDecision()` is called synchronously for app message sends |
| Request logging | Every REST request gets a UUID request ID and structured log entry |

---

## 7. OTP and Auth Infrastructure

Firebase is no longer part of the MVP auth stack. The current backend implements OTP itself.

| Task | Details |
|---|---|
| AWS SNS | Configure SMS sending for OTP delivery. |
| AWS region | `AWS_SNS_REGION`, defaulting to `ap-south-1`. |
| Redis | Required for OTP storage and rate limiting. |
| JWT secret | `JWT_SECRET` is required for access and refresh token signing. |
| Refresh token table | `RefreshToken` records store token hash, expiry, revocation state, and user relation. |
| Test numbers | Backend needs a safe development/test OTP strategy; do not rely on production SMS for every local test. |
| India delivery | Complete DLT registration if Indian production phone numbers are targeted. |

---

## 8. Build & Delivery Plan

### 8.1 Development Phases

| Phase | What Gets Built | Owner / Notes |
|---|---|---|
| Phase 0: API contract freeze | Confirm current `/api/v1` contract, token handling, error shapes, and environment URLs | Backend + app developers |
| Phase 1: Android native app foundation | Kotlin project, theme layer, networking client, secure token storage | Android developer |
| Phase 2: iOS native app foundation | Swift project, theme layer, networking client, secure token storage | iOS developer |
| Phase 3: Auth flow | Phone entry, OTP request, OTP verify, token refresh/logout on both platforms | Android + iOS |
| Phase 4: Chat flow | History pagination, send message, loading/retry/error states on both platforms | Android + iOS |
| Phase 5: Integration testing | End-to-end testing against staging backend | Backend + app developers |
| Phase 6: Internal release | Play Store internal testing and TestFlight | Founder + app developers |

### 8.2 Timeline Estimate

| Workstream | Estimated Duration |
|---|---|
| API contract cleanup and staging readiness | 2-4 days |
| Android MVP app | 2-4 weeks |
| iOS MVP app | 2-4 weeks |
| Backend/app integration and QA | 1-2 weeks |
| Store internal testing setup | 2-4 days |

Android and iOS can proceed in parallel once the API contract is frozen.

### 8.3 Testing Strategy

- Backend build must pass with `pnpm build`.
- Backend health check must pass against staging before app integration.
- Interactive API docs are available at `GET /api/docs` for manual endpoint testing during development.
- Test OTP flow in a non-production-safe way before using real SMS.
- Test access-token expiry and refresh-token recovery.
- Test logout revocation and local token deletion.
- Test message send timeout handling.
- Test message pagination with old WhatsApp history and app-created messages.
- Android testing: physical Android devices plus emulator coverage.
- iOS testing: simulator plus physical device through TestFlight before wider release.

---

## 9. Non-Functional Requirements

| Requirement | Expectation |
|---|---|
| Performance | Chat history should load within 2 seconds on a standard 4G connection for the default 50-message page. |
| Reliability | API failures must surface user-friendly errors; never blank screen or crash. |
| Security | HTTPS only in production; secure token storage; no OTP/token logging; JWT expiry and refresh revocation enforced. |
| Privacy | User messages are not used for advertising and are not diagnostically analyzed without consent. |
| Accessibility | Minimum readable font size, sufficient contrast, platform-standard touch targets. |
| Offline behavior | Show graceful offline state. Do not drop typed text if a send fails. |
| Observability | Client error logs should include endpoint, status code, and `X-Request-Id` when present. |
| Native consistency | Android and iOS should feel platform-native while preserving the same meCove brand and product behavior. |

---

## 10. Future Roadmap (Post-MVP)

| Feature | Phase | Notes |
|---|---|---|
| Push notifications | Phase 2 | Reminders, check-ins, coach messages |
| SessionBridge report UI | Phase 2 | Backend API complete. Mobile: Reports tab with type + range pickers, PDF download, status polling |
| Myself Lately report UI | Phase 2 | Backend API complete. Mobile: same Reports tab, second report type |
| Check-in UI | Phase 2 | Backend API complete. Mobile: Settings screen time picker + on/off toggle |
| Account management UI | Phase 2 | Backend API complete. Mobile: stats screen, data deletion, privacy notice |
| Habit tracker | Phase 3 | Track behaviors, streaks, check-ins |
| Goal tracker | Phase 3 | User-defined goals with progress visibility |
| Idea capture | Phase 3 | Quick-entry idea notes linked to profile |
| Coach connection | Phase 4 | Optional professional access to SessionBridge |
| Emotional trend visibility | Phase 4 | Patterns over time, not diagnosis |
| Guided reflection prompts | Phase 4 | Optional, never forced |
| Web admin / support tooling | Phase 4 | Account support, consent, debugging, analytics |
| Streaming replies | Future | WebSocket/SSE or polling if synchronous reply latency becomes a UX issue |

---

## 11. Open Items & Decisions Pending

| Item | Notes |
|---|---|
| Identity consistency | Auth currently upserts an app identity by phone number, while message send can upsert an app identity by user ID. Decide whether this should be normalized before production. |
| New-user policy | Original PRD said no auto-create users. Current backend auto-creates app users after OTP verification. Product must confirm this is intended. |
| OTP test strategy | Need development/test OTP mechanism that avoids excessive real SMS use. |
| India SMS compliance | Confirm AWS SNS DLT/TRAI setup for Indian numbers. |
| App icon & splash screen | Pending final brand assets. |
| Final color palette & typography | Pending designer delivery; implement through native theme layers. |
| AI persona name in app | Decide whether assistant name appears in chat. |
| WhatsApp continuity | Decide whether WhatsApp remains active indefinitely or transitions users to app over time. |
| Store accounts | Play Store and Apple Developer accounts must be ready before internal testing. |
| Privacy / terms acceptance | Backend has fields for privacy, terms, and MVP acceptance; app UX requirements need confirmation. |

---

## Appendix: Glossary

| Term | Definition |
|---|---|
| meCove backend | Existing backend service: mobile REST API, WhatsApp webhooks, AI logic, user profiles, message storage |
| Native Android app | Android app built separately using Kotlin |
| Native iOS app | iOS app built separately using Swift |
| OTP | One-time password; 6-digit SMS code used to verify phone number ownership |
| AWS SNS | AWS Simple Notification Service, currently used for SMS OTP delivery |
| Access token | Short-lived JWT used in `Authorization: Bearer` header |
| Refresh token | 30-day JWT used to obtain a new access token; stored server-side as a SHA-256 hash |
| Redis | In-memory store used for OTP, rate limiting, and queues |
| Prisma | TypeScript ORM used to access PostgreSQL |
| Identity | Backend record linking a user to a channel such as WhatsApp or app |
| SessionBridge | meCove's counsellor-oriented reflection report |
| Myself Lately | meCove's user-facing reflective report |
| DEK | Data encryption key used to encrypt/decrypt a user's messages |
| KEK | Key encryption key used to wrap per-user DEKs |
| `X-Request-Id` | Per-request ID returned by the backend for traceability |

---

*End of Document*  
*meCove (c) 2026 | Confidential*

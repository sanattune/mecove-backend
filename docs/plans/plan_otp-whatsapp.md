# Plan — OTP delivery via WhatsApp (replace AWS SNS SMS)

**Status:** SUPERSEDED (2026-06-23) → absorbed into [plan_whatsapp-messaging](plan_whatsapp-messaging.md)
> This plan was merged into `plan_whatsapp-messaging.md`, which owns the shared
> `sendWhatsAppTemplate()` foundation used by both OTP and professional-support Phase 6.
> Kept for history; do not action from here.

## Goal
Send the login OTP over **WhatsApp only** via a Meta-approved Authentication-category
template, replacing AWS SNS SMS (`infra/otp.ts → sendOtpSms`). No SMS fallback.

## Decisions locked
- **WhatsApp-only** (2026-06-23) — drop SMS entirely. Accepted risk: a signup phone
  not on WhatsApp cannot receive an OTP (lockout); acceptable for now.
- Requires a Meta-approved **Authentication-category template**; build is staged
  behind a configurable template name so it can ship dark until approved.
- Sequenced **after** coach-support.

## Defaults chosen
- Template name + language via env (`WHATSAPP_OTP_TEMPLATE_NAME`,
  `WHATSAPP_OTP_TEMPLATE_LANG` default `en`) — no redeploy to swap templates.
- Keep OTP generation/store/verify (Redis) unchanged; only the **delivery** swaps.
- Retire AWS SNS usage for OTP; `AWS_SNS_REGION` no longer required for auth (keep
  AWS creds only if used elsewhere).

## Architecture fit
Extends `infra/whatsapp.ts` with `sendWhatsAppTemplate()` (Graph API `messages`,
`type: "template"`) — the first template (vs free-form) sender; free-form only works
in the 24h customer-service window, which a cold signup number is not in. `infra/otp.ts`
swaps `sendOtpSms` → `sendOtpWhatsApp`. `authHandler` request-otp interface unchanged.
Deliberate channel switch with a lockout tradeoff → **candidate for a short ADR**
(OTP channel = WhatsApp, SMS dropped).

## Implementation steps
1. `infra/whatsapp.ts`: add `sendWhatsAppTemplate(toDigits, templateName, lang, components)`
   — POST `type:"template"` with body/button parameters.
2. Env: `WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_OTP_TEMPLATE_LANG` (validate at startup).
3. `infra/otp.ts`: replace `sendOtpSms` with `sendOtpWhatsApp(phone, otp)` building the
   template components (body code param + copy-code button param if used). Remove SNS.
4. `authHandler` request-otp → call `sendOtpWhatsApp`. Rate limits unchanged.
5. Drop `@aws-sdk/client-sns` OTP usage; prune env docs.
6. Verify against a WhatsApp-enabled test number.

## Documentation impact (MANDATORY)
- Tracker row (`docs/plans/README.md`): ALWAYS (added with this plan).
- ADR (`docs/adr/`): likely `0005-otp-over-whatsapp.md` — channel switch + lockout tradeoff.
- CONTEXT.md: none (no new domain vocabulary).
- Module CLAUDE.md: root `CLAUDE.md` (env vars + "request-otp via WhatsApp"),
  `src/api/CLAUDE.md` (request-otp row), `src/infra/CLAUDE.md` (new `sendWhatsAppTemplate`).
- API spec: minor description tweak for `/auth/request-otp` (no shape change) →
  regenerate `docs/openapi.yaml` + `../docs/specs/openapi.yaml`.
- Memory: yes (delivery channel change).
- Runbook: the "How to get the Meta template" section below; consider a short
  `docs/whatsapp-otp-template.md` runbook.

## How to get the Meta Authentication template (guidance)
1. Meta **WhatsApp Manager → Message Templates → Create template**.
2. **Category: Authentication.**
3. Pick a code-delivery type: **Copy-code button** (simplest) or one-tap **autofill**
   (autofill needs the Android app's package name + signing-key hash — more setup).
4. The Authentication body auto-includes the code parameter and an expiry line; set
   code-expiry minutes to match our Redis OTP TTL (currently 10 min).
5. Submit for approval (auth templates are usually approved quickly).
6. Record the **template name** + **language code**; set `WHATSAPP_OTP_TEMPLATE_NAME`.
Note: the business phone number must be a registered WhatsApp Business sender (already
true — we run the WhatsApp channel).

## Open questions
- Copy-code button vs one-tap autofill (autofill = best UX, more setup). Default:
  copy-code first.
- Remove AWS SNS entirely, or keep the SDK for any non-OTP use? (Confirm no other SNS use.)
- Localization of the template language per user, or single `en`?

## Risks / watch-items
- **Lockout:** non-WhatsApp numbers can't receive OTP — accepted; revisit if support
  load appears.
- **Template not approved = hard blocker** — mitigated by shipping behind the config
  name (SMS can stay live until the flip if we choose).
- WhatsApp per-number messaging/throughput limits at signup spikes.

## Verification
`POST /auth/request-otp` to a WhatsApp-enabled test number → template message with code
arrives → `POST /auth/verify` returns a token pair. Confirm no SNS call is made.

# OTP is delivered over WhatsApp, not SMS

## Context

Mobile-app sign-in uses a phone OTP. The original implementation sent the code via
**AWS SNS SMS** (`infra/otp.ts → sendOtpSms`). SMS to Indian numbers requires DLT/TRAI
registration, which we never completed — so SMS OTP was effectively non-functional for
our primary market. meCove already runs a live WhatsApp Business sender (the WhatsApp
channel), and WhatsApp **authentication-category templates** deliver to cold numbers
without a prior inbound message.

## Decision

**OTP is delivered exclusively over WhatsApp**, via the Meta-approved `mecove_otp`
authentication template (copy-code button, 10-minute validity matching the Redis TTL).

- `sendOtpSms` (AWS SNS) is removed; `infra/otp.ts` exposes `sendOtpWhatsApp(phone, otp)`,
  which calls the new generic `sendWhatsAppTemplate()` in `infra/whatsapp.ts`.
- The code is placed in **both** the body parameter and the copy-code button parameter
  (Meta rejects a missing button param with `(#132000) parameters do not match`).
- The `@aws-sdk/client-sns` dependency and `AWS_SNS_REGION` (for OTP) are pruned. AWS SNS
  had no other use in the codebase.
- Template name + language live as **constants** in `WHATSAPP_TEMPLATES` (immutable in
  Meta, identical across envs), with optional env overrides
  (`WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG`) as an escape hatch. This
  supersedes the earlier plan note that template names would be required env vars.
- `OTP_DEV_MODE=true` logs the code and skips the live send for local development.

## Consequences

- **Accepted tradeoff:** numbers without WhatsApp cannot receive an OTP and are locked
  out of sign-in. This is acceptable given the product's WhatsApp-first audience.
- OTP now hard-depends on the WhatsApp env (`WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_PERMANENT_TOKEN`); a missing token breaks all sign-ups, not just replies.
- The same `sendWhatsAppTemplate()` unblocks professional-support **Phase 6**
  (cold-number invites via `mecove_pro_invite`) — see
  `docs/plans/plan_whatsapp-messaging.md`.
- The OTP shape only truly validates at runtime: a live test-send returning 200 is the
  verification gate before flipping production off SMS.

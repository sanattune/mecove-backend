# Plan — WhatsApp template messaging (OTP + professional-support notifications)

**Status:** PENDING · **Urgency:** NOW · **Created:** 2026-06-23 · **Branch:** `whatsapp-messaging`
> Tracked in [docs/plans/README.md]. Consolidates the former `plan_otp-whatsapp`
> (now SUPERSEDED) and delivers professional-support **Phase 6** (notifications).
> Two-stage: **(1) submit Meta templates NOW** (approval lead time) → **(2) build code
> once approved.**

## Goal
Add a WhatsApp **template-message** capability and use it for (a) **WhatsApp-only OTP**
(replacing AWS SNS SMS) and (b) **professional-support notifications** (cold-number
invite + engagement events). Free-form WhatsApp only delivers within 24h of an inbound
message, so reaching cold signup phones / invitees requires approved templates.

## Decisions locked
- **OTP = WhatsApp-only** (2026-06-23), no SMS fallback; non-WhatsApp numbers can't get
  an OTP (accepted lockout).
- Cold-number outreach (OTP, invites) **requires Meta-approved templates**.
- **App push (FCM) is DEFERRED** — not built in this plan. Instead: client notifications
  go over WhatsApp; professional notifications surface in the **web portal on login**
  (the data already exists via the `GET /professional/engagements...` endpoints — no
  push infra needed). Email/FCM is a later, separate plan.
- Consolidates `plan_otp-whatsapp` (SUPERSEDED → absorbed here).

## Defaults chosen
- Template names + language via env (`WHATSAPP_OTP_TEMPLATE_NAME`,
  `WHATSAPP_INVITE_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG=en`).
- OTP via **copy-code** button (simplest) — not one-tap autofill (autofill needs the
  Android package + signing-key hash; revisit later for better UX).
- Invite template submitted as **Utility** (framed as an account notification).
- For engagement events to users already in a 24h session, send **free-form**
  (`sendWhatsAppReply`); only cold/out-of-session needs a template.

## Architecture fit
- New `sendWhatsAppTemplate(toDigits, name, lang, components)` in `infra/whatsapp.ts`
  (Graph API v19.0 `messages`, `type:"template"`) — the first template (vs free-form)
  sender. Mirrors the existing `sendWhatsAppReply`/`sendWhatsAppButtons` shape.
- `infra/otp.ts` swaps `sendOtpSms` (SNS) → `sendOtpWhatsApp` (template).
- A small notification helper for professional-support events (channel choice per
  recipient/event).
- **ADR-0005** — OTP channel switch to WhatsApp (drops SMS; lockout tradeoff).

## Stage 1 — Submit Meta templates NOW (no code dependency)
See **`docs/whatsapp-templates.md`** for submission-ready specs. Two templates:
1. **`mecove_otp`** — Authentication category, copy-code button, 10-min validity.
2. **`mecove_pro_invite`** — Utility category, params for professional name + type.
Submit in Meta WhatsApp Manager → Message Templates. Record approved names → set env.
Our WhatsApp Business sender is already live (we run the WA channel).

## Stage 2 — Implementation steps (after templates approved)
1. `infra/whatsapp.ts`: `sendWhatsAppTemplate()` + startup validation of template-name env.
2. **OTP:** `sendOtpWhatsApp(phone, otp)`; wire `/auth/request-otp`; remove SNS usage;
   prune `@aws-sdk/client-sns` + `AWS_SNS_REGION` (for OTP). ADR-0005.
3. **Phase 6 B1 — invite delivery (D17b):** on `POST /professional/engagements` for a
   COLD phone (no account), fire `mecove_pro_invite`. (Currently the invite is stored
   silently.)
4. **Phase 6 B2 — insight-request (D8):** `POST /professional/engagements/:id/request-insight`
   → transient notification to the client (no table). WhatsApp (free-form if in-session,
   else template TBD) — may need a third template if always cold.
5. **Phase 6 B3 — notify-other-party:** hooks on accept / share / end. Client side →
   WhatsApp; professional side → portal-on-login (no push). Pick free-form vs template
   by session state.
6. **(Deferred) app push / FCM** — separate future plan; pro real-time push + client app
   push live there.

## Documentation impact (MANDATORY)
- Tracker (`docs/plans/README.md`): this row (PENDING); move `plan_otp-whatsapp` to Superseded.
- ADR (`docs/adr/`): `0005-otp-over-whatsapp.md` (channel switch).
- CONTEXT.md: none (no new domain vocabulary).
- Module CLAUDE.md: root `CLAUDE.md` (env vars + request-otp via WhatsApp),
  `src/api/CLAUDE.md` (request-otp + request-insight rows), `src/infra/CLAUDE.md`
  (`sendWhatsAppTemplate`), `docs/plans/plan_professional-support.md` (Phase 6 → here).
- API spec: `/auth/request-otp` description + new `/professional/engagements/:id/request-insight`
  → regenerate `docs/openapi.yaml` + canonical `../docs/specs/openapi.yaml`.
- Memory: yes. Runbook: `docs/whatsapp-templates.md` (submission specs).

## Open questions
- Invite template category: Utility vs Marketing (Meta may reclassify a promotional-
  sounding invite as Marketing). Submit as Utility; adjust if rejected.
- Invite CTA link: the app isn't on a store yet — no install URL. Submit invite copy
  WITHOUT a URL button for now, or with a placeholder to fill at store launch.
- Remove AWS SNS entirely, or keep the SDK for any non-OTP use? (Confirm no other use.)
- insight-request (B2): always-cold → needs its own template, or assume in-session?

## Risks / watch-items
- **Template rejection/delay** — the long pole; blocks all delivery. Mitigate by
  submitting early (Stage 1) and keeping copy simple/compliant.
- **Non-WhatsApp numbers locked out of OTP** — accepted.
- **FCM deferral** — professionals get no real-time push; portal-on-login only. Revisit
  if it's insufficient.

## Verification
- OTP: `POST /auth/request-otp` to a WhatsApp-enabled test number → template code arrives
  → `/auth/verify` returns tokens; confirm no SNS call.
- Invite: `POST /professional/engagements` for a cold phone → `mecove_pro_invite` arrives.
- Phase 6 events deliver to the right recipient/channel.

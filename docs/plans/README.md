# Plans Tracker

Master status index of every plan. **A plan that is not in this tracker does not exist.**
Full detail lives in each `plan_<name>.md`; this is the map.

_Last reconciled: 2026-06-23_ (professional-support 0–5,7,8 shipped; Phase 6 → plan_whatsapp-messaging; plan_otp-whatsapp superseded)

**Status:** `DONE` (shipped) · `PARTIAL` (core shipped, tail open) · `PENDING` (not started) ·
`SUPERSEDED` (killed/absorbed) · `MOVED` (re-homed out of plans/).
**Urgency:** `NOW` · `LATER` · `FUTURE` · `—` (nothing left).

## Active

| Plan | Status | Urgency | Created | Closed | What's left |
|---|---|---|---|---|---|
| [plan_professional-support](plan_professional-support.md) | PARTIAL | NOW | 2026-06-23 | — | Phases 0–5, 7, 8 DONE (data model, pro onboarding, engagement create, client accept+reconcile, insight sharing, lifecycle, account-delete→messages-only, **verification admin**). Phase 6 (notifications) delivered via [plan_whatsapp-messaging](plan_whatsapp-messaging.md): B1 cold-invite over WhatsApp built; B3 notify = no-op by decision; B2 insight-request deferred to that plan's backlog. Feature functionally complete. |
| [plan_whatsapp-messaging](plan_whatsapp-messaging.md) | SHIPPED | NOW | 2026-06-23 | 2026-06-23 | WhatsApp-only OTP + professional-support Phase 6. Both templates APPROVED + runtime-verified (live test-sends, 200). Built: `sendWhatsAppTemplate`, `sendOtpWhatsApp` (SNS pruned, ADR-0005), cold-invite `sendProInviteWhatsApp`. B2 insight-request DEFERRED (backlog); B3 notify = no-op by decision. FCM deferred. |
| [plan_insight-rename](plan_insight-rename.md) | PARTIAL | LATER | 2026-06-23 | — | Backend + Android code DONE & pushed; build green. Tail: rebuild + ship APK to testers; runtime-test Android against new `/insights/*` API. |

## Done

| Plan | Status | Urgency | Created | Closed | What's left |
|---|---|---|---|---|---|
| _none yet_ | | | | | |

## Superseded / killed

| Plan | Status | Urgency | Created | Closed | What's left |
|---|---|---|---|---|---|
| [plan_otp-whatsapp](plan_otp-whatsapp.md) | SUPERSEDED | — | 2026-06-23 | 2026-06-23 | Absorbed into [plan_whatsapp-messaging](plan_whatsapp-messaging.md) (shares the `sendWhatsAppTemplate()` foundation with Phase 6 notifications). |

## Moved

| Plan | Status | Urgency | Created | Closed | What's left |
|---|---|---|---|---|---|
| _none_ | | | | | |

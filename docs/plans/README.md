# Plans Tracker

Master status index of every plan. **A plan that is not in this tracker does not exist.**
Full detail lives in each `plan_<name>.md`; this is the map.

_Last reconciled: 2026-06-23_ (coach-support Phases 0–3 shipped)

**Status:** `DONE` (shipped) · `PARTIAL` (core shipped, tail open) · `PENDING` (not started) ·
`SUPERSEDED` (killed/absorbed) · `MOVED` (re-homed out of plans/).
**Urgency:** `NOW` · `LATER` · `FUTURE` · `—` (nothing left).

## Active

| Plan | Status | Urgency | Created | Closed | What's left |
|---|---|---|---|---|---|
| [plan_coach-support](plan_coach-support.md) | PARTIAL | NOW | 2026-06-23 | — | Phases 0 (data model), 1 (pro onboarding), 2 (engagement create), 3 (client accept + invite reconciliation on signup) DONE. Phases 4–8 pending (sharing → lifecycle → notifications → account-delete → verification). |
| [plan_otp-whatsapp](plan_otp-whatsapp.md) | PENDING | LATER | 2026-06-23 | — | Replace AWS SNS SMS OTP with WhatsApp-only (Authentication template). Parked until coach-support done. Needs Meta-approved template; shared `sendWhatsAppTemplate()` also unblocks coach Phase 6. |
| [plan_insight-rename](plan_insight-rename.md) | PARTIAL | LATER | 2026-06-23 | — | Backend + Android code DONE & pushed; build green. Tail: rebuild + ship APK to testers; runtime-test Android against new `/insights/*` API. |

## Done

| Plan | Status | Urgency | Created | Closed | What's left |
|---|---|---|---|---|---|
| _none yet_ | | | | | |

## Superseded / killed

| Plan | Status | Urgency | Created | Closed | What's left |
|---|---|---|---|---|---|
| _none_ | | | | | |

## Moved

| Plan | Status | Urgency | Created | Closed | What's left |
|---|---|---|---|---|---|
| _none_ | | | | | |

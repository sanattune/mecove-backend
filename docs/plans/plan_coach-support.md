# Coach-Support — Implementation Plan (phased)

**Status:** PENDING · **Urgency:** NOW · **Created:** 2026-06-23 · **Branch:** `coach-support`
> Tracked in [docs/plans/README.md]. Design settled (D1–D28); no code yet. Going
> phase-by-phase, starting Phase 0.

> Design is settled in `docs/coach-support-notes.md` (D1–D28), `docs/adr/0003`,
> and the CONTEXT.md "Professional support" section. This is the BUILD plan: phases
> sequenced by dependency, each shippable on its own. We go one phase at a time.
> Backend only — the Pro **web portal** is a separate frontend; here we expose the
> role-aware API it (and the app) consume. No billing in v1 (D18).

Legend: each phase lists Deliverables, the D-decisions it implements, and Acceptance.

---

## Phase 0 — Data model + migration (foundation)
**Deliverables**
- Prisma models: `ProfessionalProfile` (1:N User), `Engagement`, `InsightShare`;
  add `User.isProfessional Boolean @default(false)` + back-relations.
- `Engagement` partial-unique on `(professionalId, clientUserId) WHERE status='active'`
  (raw SQL in migration — Prisma can't express partial-unique).
- Migration (clean add; no data concerns).
**Implements:** D3, D4, D13, D19, D22, D24.
**Acceptance:** `prisma generate` + `migrate dev` clean; `tsc` green; no behavior yet.

## Phase 1 — Professional identity & onboarding
**Deliverables**
- `POST /professional/profiles` — create a ProfessionalProfile (professionalType,
  additionalTitle, displayName); sets `User.isProfessional=true`;
  `verificationStatus='pending'`.
- `GET /professional/profiles` — list caller's own profiles.
- Role-aware auth helper: `requireProfessional` / "does caller own profile X".
- CORS: add web-portal origin to `CORS_ALLOWED_ORIGINS` (D16).
**Implements:** D1–D3, D13, D15, D16.
**Acceptance:** a User can self-register a Pro profile, immediately active; flag flips.

## Phase 2 — Engagement creation (Pro side)
**Deliverables**
- `POST /professional/engagements` — Pro opens an Engagement against a client:
  - **add** (client already exists): resolve by phone → set `clientUserId`.
  - **invite** (no account): store pending invite with `inviteePhone`, null client.
  - sets term (`startDate`/`endDate`), `status='pending'`.
  - reject duplicate active (D24).
- `GET /professional/engagements` — Pro lists their engagements + linked client
  profile (name/phone) for active ones (D7).
**Implements:** D4, D5, D7, D9, D10, D17, D26 (write side).
**Acceptance:** Pro can invite/add; pending row created; duplicate active blocked.

## Phase 3 — Client accept + pending-invite reconciliation
**Deliverables**
- `GET /engagements` — client lists their engagements (pending + active).
- `POST /engagements/:id/accept` — client accepts → `status='active'`, `acceptedAt`.
- Reconciliation hook in OTP verify (`/auth/verify`): on signup, match
  `inviteePhone == normalized phone` → set `clientUserId`, surface pending (D26).
  Requires consistent E.164 phone normalization at invite + signup.
**Implements:** D5, D17, D26.
**Acceptance:** invited existing user sees + accepts; new signup reconciles by phone.

## Phase 4 — Insight sharing (client-controlled)
**Deliverables**
- `POST /engagements/:id/shares` — client shares an Insight (any type, D6 reframe) →
  `InsightShare`. `DELETE /engagements/:id/shares/:insightId` — unshare (set
  `revokedAt`, D12). Re-share clears it.
- Per-engagement `autoSendSessionBridge` toggle endpoint; on new SessionBridge
  Insight completion, auto-create shares for engagements with toggle on (D28).
- Pro read: `GET /professional/engagements/:id/insights` (+ `/:insightId/pdf`) —
  access derived: active Engagement AND non-revoked share (D23). No pull of
  unshared/raw.
**Implements:** D6, D12, D19, D20, D22, D23, D28.
**Acceptance:** Pro sees only shared, non-revoked insights on active engagements;
unshare and engagement-end both cut access with no extra writes.

## Phase 5 — Engagement lifecycle: end / expiry / renewal
**Deliverables**
- `POST /engagements/:id/end` (client) + `POST /professional/engagements/:id/end`
  (pro) — either side ends → `status='ended'`, `endedAt`, `endedBy`; notify other
  (D11). Access cut by derivation (no bulk revoke).
- Scheduled expiry: a job closes engagements past `endDate` (D9) — reuse the
  existing engagement/reminder scheduler infra.
- Renewal = create a fresh Engagement (D10) — already covered by Phase 2.
**Implements:** D9, D10, D11.
**Acceptance:** either party ends; expired engagements auto-close; Pro access gone.

## Phase 6 — Notifications
**Deliverables**
- Client events (invite-to-accept, insight-request nudge D8, engagement ended):
  **WhatsApp + app push**.
- Pro events (accepted, insight shared, engagement ended): **app push + portal**.
- `POST /professional/engagements/:id/request-insight` — transient nudge, NO table
  (D8).
**Implements:** D8, D21, D17b.
**RISK/DEP:** app **push (FCM)** infra may not exist yet — WhatsApp client does.
Confirm/stand up push before this phase, or stage WhatsApp-first then add push.
**Acceptance:** each event reaches the right recipient on the right channel.

## Phase 7 — Account-delete behavior change
**Deliverables**
- Change `DELETE /account/data` to **messages-only** (drop `prisma.insight.deleteMany`)
  — accountHandler.ts:48-51 (D25). Insights/engagements/shares survive.
- Privacy note recorded (plaintext Insights survive an erase — D22b/D25).
**Implements:** D25.
**Acceptance:** delete wipes messages only; shares stay valid; stats.lastInsight works.

## Phase 8 — Verification admin (async trust badge)
**Deliverables**
- Minimal admin path to set `verificationStatus` (manual/SQL or a tiny admin
  endpoint). Surfaces as a badge; non-blocking (client-accept is the real gate, D15).
**Implements:** D15.
**Acceptance:** team can mark a Pro verified; badge exposed in profile reads.

---

## Sequencing & dependencies
0 → 1 → 2 → 3 → 4 are the critical chain. 5/6 build on 2–4. 7 is independent (do
anytime). 8 is minor/last. Cross-cutting from Phase 1: role-aware auth + CORS.

## Out of scope (v1)
Billing/subscription (D18 — design-for-later), Pro directory/discovery (D14),
SMS invites (D17b — WhatsApp instead), the Pro web-portal frontend itself,
scope-bounded access beyond time+per-insight (D27).

## Open items to confirm per phase (not blockers)
- Phase 1: ProfessionalProfile minimal fields beyond type/title/displayName
  (bio/practiceName/email?) — keep lean (D13).
- Phase 2: how Pro identifies the client to "add" (phone entry vs lookup); term
  defaults if Pro omits endDate.
- Phase 6: push (FCM) infra existence + device-token registration model.

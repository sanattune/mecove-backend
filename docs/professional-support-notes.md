# Professional Support — Design Notes (scratch)

> Working notes for the `professional-support` branch. NOT canonical. Merge settled
> terms into CONTEXT.md and decisions into docs/adr/ once the design stabilises.

## Status: grilling in progress

## Settled decisions

### D1 — Everyone is a User (account = auth principal)
`User` is the single login/auth principal: Identity (channel binding), OTP, JWT,
refresh tokens. Nothing role-specific is intrinsic to it.

### D2 — Client and Professional are non-exclusive roles
A User has **0-or-1 Client role** and **0-or-1 Professional role**, independently.
- Solo journaler = User + Client
- Therapist who never journals = User + Professional
- Both at once is allowed.
Client-ness is the **journaling role** and can exist with or without a Professional.

### D3 — Physical model: inline Client, separate Professional (updated 2026-06-23)
Keep journaling fields on the `User` row (User row doubles as the Client profile).
Add:
- `ProfessionalProfile` — **1:N with User** (updated from 1:1). A User may run
  multiple distinct profiles (e.g. a `therapist` profile AND a `career coach`
  profile), each with its own `professionalType`/`displayName`.
- `User.isProfessional` Boolean — **denormalized convenience flag** for a cheap
  "is this user any kind of pro" gate without a join. SOURCE OF TRUTH = existence
  of ≥1 ProfessionalProfile row; keep flag in sync on profile create/delete.
- `Engagement` link table — FKs a **specific** ProfessionalProfile (which hat the
  Pro is wearing), not the raw User.
- Pro-ness is NOT `User.role` (that stays `user`/`admin`); roles are non-exclusive
  (D2), a single role string can't hold both.
No migration of existing journaling FKs. Revisit a full `Client` table split only
if the Client role grows independent attributes.

### D4 — The association is an "Engagement" (provisional)
The Pro↔Client link is a first-class entity called **Engagement**, not a dumb join.
- Created by the Professional: **invite** (user doesn't exist yet) or **add**
  (user already exists).
- Has a **fixed boundary** (TBD: time-bounded and/or scope-bounded).
- Carries **access limitations** on the client's data (consent scope — TBD).

### D5 — Client-accept is the universal consent gate
Pro creates Engagement → **pending**. No client data flows until the Client
explicitly accepts. Same rule for invite (new user) and add (existing user).
Lifecycle: `pending → active (client accepts) → ended/revoked`. Consistent with
existing COV-88 privacy gate (consent as hard pre-condition).

### D6 — Sharing is client-controlled: per-artifact push, with optional auto-send
On an active Engagement the Pro sees the **Insights** (D20) the Client discloses.
- **Default:** Client pushes each Insight explicitly, one at a time.
- **Opt-in:** Client may set a per-Engagement toggle "auto-send my SessionBridge
  Insights to this Professional" — then new ones flow automatically.
- **REFRAMED (2026-06-23, was SessionBridge-only):** Client may share **any
  generated Insight they choose** — SessionBridge OR Myself-Lately. The old
  type-whitelist is dropped; the privacy spine is what holds: **no raw
  journal/daily log, no Pro-side pull.** Client controls disclosure, picks which
  Engagement, flips the toggle off any time.
- OPEN: does auto-send apply to all Insight types or only SessionBridge? (lean:
  auto-send default scoped to SessionBridge; Myself-Lately share = manual only.)

### D7 — Pro sees the Client's profile
On an Engagement the Pro can see the linked Client's profile: name, phone, etc.
The relationship is mutually known. (Not anonymised.)

### D8 — Pro can send non-binding insight-requests (transient, no table)
Pro may nudge "please share a SessionBridge for <range>". It's a **transient
notification only — nothing stored** (no InsightRequest table in v1). The Client
still decides whether to generate + share. No data moves without the Client acting.
(TERMINOLOGY: "insight-request", not "report request" — we don't use "report".)

### D9 — Engagement is time-bounded
Engagement has a start + end date. On end it auto-closes: no new reports flow.
Implies: expiry handling, extension/renewal path, and a rule for reports already
shared before end (Q10/Q11).

### D10 — Pro sets the term; renewal = new Engagement record
Pro sets the end date at creation. Extending = creating a **new** Engagement
record for the next term, which the Client must accept fresh (consent gate per
term). Old records remain as history. No silent auto-renew.

### D11 — Either side ends early; on end, ALL access is revoked
- Either party may end an active Engagement unilaterally; the other is notified.
  (Client can always cut — it's their data; Pro can drop a client too.)
- On end (expiry OR termination), the Pro loses access to **all** previously
  shared SessionBridge reports. Access fully cut, maximally privacy-protective.
- CAVEAT (product, non-blocking): a Pro could have **downloaded** a shared PDF
  while live; revocation cuts system access but can't claw back a local copy.
  Consider view-only / no-download / watermark for shared reports.

### D12 — Per-report unshare (tentative yes)
Client can revoke a single already-shared report while keeping the Engagement and
other reports intact. Fine-grained version of D11. Implies "Pro access to report"
is a toggle-able grant, not a copy. Marked tentative.

### D13 — ProfessionalProfile is lean; type is the key field
Lean first cut. The load-bearing attribute is the professional **type**:
- `professionalType` — fixed enum of 3: `therapist | counsellor | coach`
  (single-select)
- `additionalTitle` — free text for the specific designation
  (e.g. type=`coach`, additionalTitle=`"career coach"`)
- plus minimal: displayName, (bio/practiceName/email TBD — keep minimal)

### D14 — Engagement-private profile, no directory (for now)
ProfessionalProfile is visible only to that Pro's own invited/engaged clients.
No public/browsable directory in v1. All initiation stays Pro-side (D4). Discovery
is a deferred, separate product surface.

### D15 — Self-serve onboarding via online form + async verification
A User becomes a Professional by filling an **online onboarding form**. They are
active immediately (can invite/add clients). A `verificationStatus` is reviewed
async by the team and surfaces as a trust badge — non-blocking. Client-accept
(D5) remains the primary safety gate; verification is secondary trust.

### D16 — Pro surface: web portal primary; app read-only (updated 2026-06-23)
Professionals use a **web portal** as primary: onboarding form + all admin live
**web-only**. The **mobile app gives Pros a read-only-ish view**: read shared
Insights, send a notification/nudge, send a quick message. No Pro admin on app.
- BACKEND TAKEAWAY: surface (web vs app) is largely a **frontend concern** — same
  `/api/v1`, same OTP/JWT, same JSON. Backend only cares about three things:
  (1) **role-aware endpoints** (is this User a Pro on this Engagement?),
  (2) **CORS** for the web origin (`CORS_ALLOWED_ORIGINS` already exists),
  (3) **Pro is a push target** (same app-push infra as clients, optional email).
  No new auth model.

### D17 — Invite to non-existent user = pending invite, no User row
Pro invites a phone with no account → store a **pending invite keyed by phone**
(no ghost User row). On that phone's OTP signup, reconcile via Identity
`@@unique([channel, channelUserKey])` → surface the pending Engagement to accept.
### D17b — Invite delivery over WhatsApp (not SMS)
Invited phone is reached via the **existing WhatsApp channel**, not SMS. Avoids
DLT/TRAI registration (SMS-only cost). Same mechanism already used for OTP/system
messages. Pending invite keyed by phone (D17) still surfaces on signup as the
consent gate.
- NUANCE: WhatsApp Business API cannot free-text a cold number — needs a
  **pre-approved template message**; recipient must be on WhatsApp; confirm the
  allowlist gate doesn't block a non-user invite. Cheap, not zero setup.

### D18 — Billing: free v1, flat per-Pro subscription later
v1 ships **no billing code and no paywall**. Pro is active immediately (D15
unchanged); all Pro features free in v1. Subscription is a *designed-for, not-yet-
enforced* future: **flat per-Pro** (one subscription per Professional, unlimited
clients) — so NO per-seat/engagement counting, ever. Schema needs nothing now; a
`subscriptionStatus` stub on ProfessionalProfile can land when billing ships.

---

### D19 — Many active Pros per Client; share scoped per-Engagement
A Client may hold **N concurrent active Engagements** (therapist + coach +
counsellor at once). Each is independently scoped. An **InsightShare grants ONE
Engagement** access to ONE Insight — NOT the Client's whole Pro set. Auto-send
toggle (D6) is also per-Engagement. Consequence: InsightShare FK = Engagement, not
Client/Professional directly. Least-disclosure: a coach never auto-sees a
therapist's shared Insights.

### D20 — Generated artifacts live in an "Insight" registry (generalizes Summary)
Rename/generalize today's `Summary` model into **Insight**: one row per generated
document for a user. Carries `insightType` (`sessionbridge | myself-lately`, the
old `reportType`), `status`, storage pointer. Future: artifacts move to **S3**
with a doc id (today they're `pdfBytes` in DB).
- **ReportShare → InsightShare:** the grant table FKs `insightId` + `engagementId`
  (D19), `sharedAt`, `revokedAt?`, `autoSent?`. Insight model itself carries NO
  share/access state (D12 unshare = set `revokedAt`).
- Pro read access = JOIN: active Engagement + non-revoked InsightShare.
- SCOPE FLAG: the Summary→Insight rename + S3 migration is a refactor **adjacent**
  to the professional-support spine. Lock name + shape now; do the rename and S3 move as
  separate work. Professional-support v1 can ship pointing InsightShare at the existing
  Summary row id if the rename lands later.
- CONFIRMED 2026-06-23 — **S3 is OUT of professional-support scope.** No dedicated
  S3-backed table, no `s3Key`/`docId` column, no upload code in this work. Today
  Insights = `Summary` with `pdfBytes` (bytea) in Postgres + plaintext
  `summaryText`. Sharing reads that same DB-stored PDF — it does NOT depend on S3.
  S3 storage is a separate, independently-grilled track (table + s3Key + upload-on-
  generate + presigned reads) to do later.

---

### D21 — Notification fan-out targets
- **Client** events (invite-to-accept, Pro report-request nudge D8, engagement
  ended): **WhatsApp + app push.** Invite to a non-user MUST be WhatsApp (D17b).
- **Pro** events (client accepted, client shared an Insight, client ended): **app
  push** (Pro app can receive) + portal in-app surface + optional email later.
- Backend concern is only "can I reach recipient X" — push infra is shared between
  Client and Pro apps; surface choice (D16) is otherwise frontend.

---

### D22 — Data model draft (4 new tables; Summary→Insight rename deferred per D20)
```prisma
model ProfessionalProfile {        // D3 (1:N User), D13, D15
  id                 String  @id @default(uuid()) @db.Uuid
  userId             String  @db.Uuid            // FK User — NOT unique (1:N)
  professionalType   String                       // therapist | counsellor | coach
  additionalTitle    String?                      // "career coach"
  displayName        String
  verificationStatus String  @default("pending")  // async trust badge (D15)
  createdAt          DateTime @default(now())
}
// User gains: isProfessional Boolean @default(false)  // denormalized (D3)

model Engagement {                 // D4, D5, D9–D11, D19
  id              String   @id @default(uuid()) @db.Uuid
  professionalId  String   @db.Uuid              // FK ProfessionalProfile (specific hat)
  clientUserId    String?  @db.Uuid              // FK User — null while pending-invite (D17)
  inviteePhone    String?                         // set when inviting a non-user (D17)
  status          String   @default("pending")    // pending | active | ended
  startDate       DateTime?
  endDate         DateTime?                        // term end (D9/D10)
  autoSendSessionBridge Boolean @default(false)    // per-engagement toggle (D6)
  acceptedAt      DateTime?
  endedAt         DateTime?
  endedBy         String?                          // client | professional (D11)
  createdAt       DateTime @default(now())
}

model InsightShare {               // D6, D12, D19, D20
  id           String   @id @default(uuid()) @db.Uuid
  engagementId String   @db.Uuid
  insightId    String   @db.Uuid                  // FK Insight (today: Summary.id)
  sharedAt     DateTime @default(now())
  revokedAt    DateTime?                           // D12 per-insight unshare
  autoSent     Boolean  @default(false)
  @@unique([engagementId, insightId])              // one toggle-able grant per pair
}
// No InsightRequest table (D8 transient). Insight = renamed Summary (D20).
```
ACCESS RULE (proposed): Pro can read an Insight ⟺ Engagement.status=active AND
matching InsightShare with revokedAt IS NULL. So **ending an Engagement (D11) needs
NO bulk revoke** — flipping status to `ended` cuts all access by derivation; share
rows stay as history. Re-share after unshare = update existing row
(revokedAt=null, sharedAt=now), respecting the unique constraint.

---

### D22b — Insights are plaintext at rest; sharing needs no key story (verified)
Checked `worker.ts` Summary write (lines 225–291): `summaryText` and `pdfBytes`
are stored **plaintext** — NO `encryptText`. Only raw Messages are encrypted
(per-user DEK); `windowBuilder` decrypts them to build the Insight, but the result
is written in the clear. So a Pro reads a shared Insight via a pointer alone — **no
re-wrapped DEK / decrypt-on-share needed.** Sharing model (D20/D22) stands.
- FLAGGED ASYMMETRY (security/product, non-blocking): the Insight contains
  verbatim client quotes yet is stored plaintext while source messages are
  encrypted. If we ever encrypt Insights under the client DEK, the share model
  breaks again (Pro has no key). Decision to encrypt-or-not is now COUPLED to
  sharing — record before changing it.

---

### D23 — Access derived from Engagement status (confirmed)
Pro reads an Insight ⟺ `Engagement.status = active` AND matching `InsightShare`
with `revokedAt IS NULL`. Ending an Engagement (D11) cuts access by derivation —
**no bulk-revoke** of share rows; they remain as history. Per-insight unshare (D12)
= set `revokedAt`. Re-share = clear `revokedAt`, bump `sharedAt`.

### D24 — Block duplicate active engagements
Partial-unique on `(professionalId, clientUserId) WHERE status = 'active'`. One live
Engagement per profile↔client pair. Renewal (D10) creates a new record only after
the old ends. Prevents accidental double-invite.

### D25 — Account-data delete becomes messages-only (BEHAVIOR CHANGE)
Change existing `DELETE /account/data` (accountHandler.ts:48-51) to wipe **only
Messages** — drop the `prisma.summary.deleteMany` line. Insights survive; therefore
Engagements + InsightShares stay valid and intact; no dangling rows. `stats.lastReport`
keeps working after a delete.
- PRIVACY FLAG (non-blocking, accepted by product): combined with D22b (Insights are
  plaintext, hold verbatim client quotes), an account-data delete now leaves derived
  sensitive content in the clear. The "erase everything" promise is narrower than
  before. Consider: an explicit "delete my Insights too" action, or encrypting
  Insights (which would then re-break the Pro share model per D22b). Revisit when the
  delete/erase flow is formalized.

---

### D26 — Invite reconciliation on OTP signup, matched by phone
Pending invite (D17): Engagement starts pending, `clientUserId=null`,
`inviteePhone` set. On the invited phone's **OTP signup (app OR whatsapp)**, a
signup-time hook looks up pending Engagements where `inviteePhone == normalized
phone`, sets `clientUserId`, and surfaces them to accept. Reuses Identity
`@@unique([channel, channelUserKey])`. NOTE: normalize phone consistently
(E.164) at invite + signup so the match works.

### D27 — No separate scope axis (punt)
"Scope-bounded" (D4) is already satisfied by **time** (Engagement term, D9) +
**per-Insight sharing** (D6). No scope descriptor on Engagement. Revisit only if a
real use case needs typed/date-limited scope.

### D28 — Auto-send is SessionBridge-only
The `autoSendSessionBridge` toggle (D6/D22) covers **only** new SessionBridge
Insights. Myself-Lately is manual-share only — auto-pushing self-reflection to a
Pro makes no sense. Keeps the field name accurate.

---

## DESIGN COMPLETE (2026-06-23) — remaining wrap-up
- ADR: User=account / Client+Professional=roles (D1–D3) — hard to reverse,
  surprising, real trade-off. Worth an ADR. (PENDING)
- Merge settled terms (Professional, ProfessionalProfile, Client, Engagement,
  Insight, InsightShare) into CONTEXT.md. (PENDING — user said scratch-only for
  now; do on user's go-ahead.)
- Implementation slicing → issues. (PENDING)

# User is the account; Client and Professional are non-exclusive roles

## Context

meCove is adding professional support: therapists, counsellors, and coaches who
review a subset of a journaling user's generated artifacts. We needed to decide how
a "professional" relates to the existing `User` model, which today is a single
auth/account principal (Identity channel binding, OTP, JWT, refresh tokens) that
also doubles as the journaling profile.

Three shapes were considered:
1. **Role enum on User** — add `"professional"` to `User.role`.
2. **Separate account types** — distinct Professional account, separate auth.
3. **Account = principal, roles = attached profiles** (chosen).

## Decision

`User` stays the single account/auth principal — nothing role-specific is intrinsic
to it. **Client** (the journaling role) and **Professional** (the supervisory role)
are **non-exclusive roles** layered on a User:

- **Client** is kept *inline on the `User` row* (the User row doubles as the Client
  profile). No separate Client table.
- **Professional** is the existence of one or more **`ProfessionalProfile`** rows
  (1:N — a User may run several profiles, e.g. a `therapist` profile and a
  `career coach` profile). A denormalized `User.isProfessional` flag is a
  convenience cache; the source of truth is the profile rows.
- Pro-ness is therefore **not** `User.role` (that stays `user`/`admin`). A single
  role string cannot hold both roles, and roles must compose freely (a User can be
  both a journaling Client and a Professional at once).

The Professional↔Client relationship is a first-class **`Engagement`**
(Pro-initiated, client-accept-gated, time-bounded). Disclosure flows one way as
client-controlled **`InsightShare`** grants. See `docs/professional-support-notes.md` for
the full decision log (D1–D28).

## Consequences

- No migration of existing journaling FKs; `Message`/`Summary` stay keyed to
  `User.id`. History queries already span channels by `userId`, unchanged.
- Authorization becomes role-aware ("is this User a Pro on this Engagement?") rather
  than role-string checks — surface-independent (web portal or app).
- Reversing this (e.g. splitting a dedicated `Client` table) is costly once
  Engagements and shares reference the inline model — hence this record.
- The `isProfessional` flag must be kept in sync on profile create/delete.

# meCove

WhatsApp-based journaling backend. User messages flow through a classify/reply loop and roll up into periodic PDF reports. Two report types serve different audiences and ship from one shared canonicalizer.

## Language

### Reports

**SessionBridge**:
The counsellor/therapist-facing report. Factual, structured, designed to be scan-read before or during a session. Currently named "SessionBridge" in user-facing copy and as the WhatsApp button label.
_Avoid_: therapist brief, coach brief (these describe its purpose, not its name)

**Myself, Lately**:
The user-facing self-reflection recap. Soft, observational, quote-heavy. Never diagnostic.
_Avoid_: mirror, recap, self-report (older internal aliases — `mirror` still appears in code as the historical short name)

### SessionBridge sections

**Time Window & Scope**:
Header: window dates and message-count summary.

**Observed Themes**:
External topics the user kept writing about across multiple days (e.g. work conversations, sleep). Sorted by day-count.
_Avoid_: ongoing themes, recurring topics

**Signals Worth Attention**:
Recurring **internal states** that appeared on multiple days (e.g. self-doubt, exhaustion, feedback-as-identity). Distinct from Observed Themes by being state-based, not topic-based. Repetition-based only — no diagnosis, no advice.
_Avoid_: alerts, flags, concerns

**Moments of Variation**:
Date-anchored entries that capture positive-affect or contrasting moments — music, curiosity, enjoyment, relief, self-expression. Each is `{date, quote, context}`. Counterweight to Signals Worth Attention so a counsellor sees the whole emotional range.
_Avoid_: bright spots, positive moments

**Open Questions**:
Sentences the user asked themselves, verbatim, ending with `?`. Kept in the report despite not appearing in the current requirements doc — counsellors find them load-bearing.

**Decisions / Intentions**:
Decisions, plans, or named options the user wrote, with date anchors.
_Avoid_: actions, todos

**Words Used in Context**:
Per-statement table: `{statement, reflects}`. The `reflects` column carries the user's own emotion word **only if** they wrote one in or near the same statement. Empty otherwise. Replaces the older per-word vocabulary view.
_Avoid_: vocabulary, emotion words list, recorded vocabulary

**Daily Log**:
Chronological raw appendix. No summarization, no interpretation.

### Myself, Lately sections

**Opener sentence**:
One factual sentence on the surface shape of the window.

**What Has Been Coming Up**:
List of reflective sentences (no labels, no anchors) describing things that recurred across days. Schema field: `whatHasBeenComingUp: string[]`.
_Avoid_: patterns (the old field name, still understood internally)

**Moments That Stood Out**:
Date-anchored entries naming a specific first, shift, or named action.

**Something to Notice**:
Reflective sentences pointing at recurring weight — observational, not alarming. Replaces the older "Worth Flagging" name, which carried clinical-alarm connotation that didn't match the report's tone.
_Avoid_: worth flagging, concerns

**Gentle Takeaway**:
A single closing sentence. Prefers a contrast pattern ("There seems to be a contrast between X and Y"); falls back to a single gentle observation when no contrast fits.
_Avoid_: conclusion, summary, advice

### Professional support

**User**:
The single account / auth principal — Identity channel binding, OTP, JWT, refresh
tokens. Holds no role-specific data intrinsically. **Client** and **Professional**
are non-exclusive roles layered on it; a User can be both.
_Avoid_: account, profile (when you mean the auth principal)

**Client**:
The journaling role. Kept inline on the **User** row (no separate Client table) —
the User row doubles as the Client profile.
_Avoid_: customer, patient

**Professional**:
The supervisory role: a therapist, counsellor, or coach. Represented by the
existence of one or more **ProfessionalProfile** rows on a User, never by a role
string.
_Avoid_: coach (that's one professionalType, not the role name), provider, clinician

**ProfessionalProfile**:
A practice-side profile for a **Professional** (1:N with User). Carries
`professionalType` (`therapist | counsellor | coach`), `additionalTitle` (free text,
e.g. "career coach"), `displayName`, and an async-reviewed `verificationStatus`
trust badge.

**Engagement**:
The first-class Professional↔Client relationship. Pro-initiated (invite a
non-user by phone, or add an existing user), time-bounded, and gated by Client
acceptance: `pending → active → ended`. Either side may end it; access derives from
its status.
_Avoid_: connection, link, subscription

**Insight**:
A generated artifact for a user — the umbrella over **SessionBridge** and
**Myself, Lately**. Generalizes the historical `Summary` model (one row per
generated document, `insightType` replacing `reportType`).
_Avoid_: report (deprecated word — do not use), summary (the old model name)

**InsightShare**:
A client-controlled grant exposing ONE **Insight** to ONE **Engagement**. Carries
`revokedAt` (per-Insight unshare) and an `autoSent` marker. A Pro can read an
Insight only via an active Engagement with a non-revoked share. No Pro-side pull,
no access to raw journal/Daily Log.
_Avoid_: report share, disclosure

### Pipeline

**L1 canonicalizer** (shared):
Pure extractor. Reads raw user messages, emits structured per-day facts, explicit emotion words, numeric logs, and `repeatCandidates` (mixed topical/internal). No interpretation, no judgment, no categorization.

**L2 stage** (per-report):
Reads canonical, produces a draft of the report's structured shape. For SessionBridge: partitions repeats into Observed Themes vs Signals Worth Attention, picks positive-affect emotions for Moments of Variation. For Myself, Lately: writes reflective sentences and the gentle takeaway.

**L3 guardfix** (per-report):
Rewrites tone violations — clinical labels, standalone emotion words, diagnostic verbs, arc/metaphor language — and enforces schema rules.

### Tone rules

**Observational**:
Describes what appeared in the data, not what it means. "Self-doubt appeared across multiple entries" — yes. "The user struggles with criticism" — no.

**Embedded emotion words**:
Emotion words may appear inside quotes or surrounding sentences but never as a standalone item or list entry.

**Reflective**:
For Myself, Lately specifically — soft, gentle, second-person-implied, no diagnosis, no advice.

**Sparse-data rule**:
When fewer than 4 days are logged in the window, all inferred sections (themes, signals, variation, patterns, takeaway) return empty. Verbatim sections (decisions, open questions, words in context, daily log) still populate from explicit data.

## Relationships

- A **window** is a date range and produces one **SessionBridge** or one **Myself, Lately** report
- The **L1 canonicalizer** feeds both report types; **L2** and **L3** stages are per-report
- **Observed Themes** and **Signals Worth Attention** are mutually exclusive partitions of `repeatCandidates`: topical repeats go to Themes, internal-state repeats go to Signals
- **Words Used in Context** rows pull statements from canonical `facts[].sourceSnippet`; the `reflects` value, when present, comes from `explicitEmotions` for the same day
- **Moments of Variation** rows are sourced from `facts[].sourceSnippet` filtered by positive-affect emotions in the same day's `explicitEmotions`
- A **User** has 0-or-1 **Client** role (inline) and 0-or-many **ProfessionalProfile** rows, independently
- A **Professional** and a **Client** are joined by an **Engagement**; a Client may hold many concurrent Engagements
- An **InsightShare** grants one **Engagement** access to one **Insight**; access requires the Engagement to be `active` and the share not revoked
- An **Insight** is owned by the **Client** who generated it; sharing never copies it and never exposes raw journal entries

## Example dialogue

> **Dev:** "If a user writes 'feeling exposed' on five separate days, does that go in **Observed Themes** or **Signals Worth Attention**?"
> **Domain expert:** "**Signals Worth Attention** — exposure is an internal state. **Observed Themes** is for the topical surface, like work or sleep. The same five days might also show 'work conversations' as a theme, and the same quote 'feel exposed by reviews' would also surface as a row in **Words Used in Context**."

> **Dev:** "If the only thing the user wrote in the window was three messages on one day, what does **Myself, Lately** show?"
> **Domain expert:** "Sparse-data rule kicks in. Just the opener — 'Sparse window, 1 day logged' or similar. **What Has Been Coming Up**, **Something to Notice**, **Gentle Takeaway** all empty. **Moments That Stood Out** also empty. The user sees the honest signal that pattern-finding isn't defensible yet."

## Flagged ambiguities

- "patterns" was used both as a Myself, Lately section name and as a generic pipeline term — resolved: the user-facing section is now **What Has Been Coming Up**, the field name remains `patterns` internally for code continuity, but new prose in this repo should prefer the section name.
- "vocabulary" used to mean both the old SessionBridge section and the broader notion of emotion words across reports — resolved: section is now **Words Used in Context**; field is `wordsInContext`. The general notion is just "emotion words" or "explicit emotions" (canonical key).
- "flagging" carried clinical connotation in older language — resolved: replaced with **Signals Worth Attention** (counsellor-facing, repetition-based) and **Something to Notice** (user-facing, reflective).
- "report" / "summary" — deprecated as the generic word for a generated artifact; the umbrella term is now **Insight** (the `Summary` model and `reportType` field are being renamed to `Insight`/`insightType`). **SessionBridge** and **Myself, Lately** remain proper names for the two Insight types.
- "account" / "user" — resolved: **User** is the auth principal; **Client** and **Professional** are roles on it, not separate accounts.

## App interaction model

### Channel separation

**WhatsApp channel**: conversational UI only. All user actions (report generation, check-in setup, consent, data deletion) driven through chat — slash commands and button prompts simulate native UI.

**App channel**: native UI handles all structured actions. Chat is purely for journaling and informational queries (guide, greeting). No slash commands, no server-driven button prompts.

### App chat contract

`POST /api/v1/messages/send` always returns:
```json
{ "userMessage": {...}, "assistantMessage": { "content": "..." } }
```
Consistent shape always. No `actionPrompt`. No button metadata.

### Intent routing by channel

Classifier detects intent channel-agnostically. Action layer is channel-aware:

| Classifier intent | WhatsApp | App |
|---|---|---|
| `summary_request` | Two-step button prompt (type → range) | Redirect: "Use the Reports tab" |
| `setup_checkin` | Button prompt (time picker) | Redirect: "Set this in Settings" |
| `guide_query` / `greeting` / `journal_entry` | LLM reply | LLM reply (same) |

Redirect is a **pre-filter**: after classification, before LLM reply generation. No LLM cost. `generateAckDecision` receives `channel` in options.

### App UI owns structured actions

- **Consent** — signup flow, before chat is accessible
- **Report generation** — Reports tab (type + range pickers)
- **Check-in setup** — Settings screen (time picker, on/off)
- **Data deletion, stats, privacy** — Settings screen
- **Admin commands** — WhatsApp-only; not exposed in app

### App REST endpoints

All implemented under `/api/v1`. Swagger UI at `/api/docs`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/request-otp` | — | Send OTP via SMS |
| POST | `/auth/verify` | — | Verify OTP, return token pair |
| POST | `/auth/refresh` | — | Refresh access token |
| POST | `/auth/logout` | Bearer | Revoke refresh token |
| GET | `/messages` | Bearer | Paginated chat history |
| POST | `/messages/send` | Bearer | Send message, get AI reply synchronously |
| POST | `/summary/generate` | Bearer | Enqueue report, returns `summaryId` |
| GET | `/summary/:id` | Bearer | Poll report status |
| GET | `/summary/:id/pdf` | Bearer | Download PDF bytes |
| GET | `/checkin` | Bearer | Active reminder state |
| POST | `/checkin/setup` | Bearer | Set or disable daily reminder |
| GET | `/stats` | Bearer | messageCount, memberSince, lastReport |
| DELETE | `/account/data` | Bearer | Wipe all messages + reports |
| GET | `/privacy` | Bearer | Consent message and link |

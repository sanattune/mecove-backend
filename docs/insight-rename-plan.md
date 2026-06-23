# Plan — Revamp `Summary` → `Insight` (Layer 3, full rename)

> Scope decided 2026-06-23: **Layer 3** — rename the Prisma model, DB table/columns,
> internal code, **and** the public API + Android app. Sequencing: **rename FIRST**,
> then build coach-support against `Insight` (see coach-support-notes.md D20).
> S3 storage is OUT of scope (still `pdfBytes` in DB) — separate track.

## Why rename first
Coach-support already forces an app rebuild (share UI, Pro views). Building
coach-support against the old `Summary` name first would mean reworking brand-new
code. Renaming first = new code born as `Insight`, zero rework.

## PRECONDITION VERIFIED (2026-06-23) — app is pre-production
`mecove-android-app/app/build.gradle.kts`: `versionCode = 1`, `versionName = "1.0"`
(never bumped), debug BASE_URL = emulator/ngrok, release host `api.mecove.app` not
on any store (Play Store account still pending per workspace status). **There are no
published installs to break.** Therefore: **NO deprecated aliases, NO old-field-name
mapping layer, NO drain telemetry.** This is a clean **lockstep rename** — rename
backend + DTOs + rebuild the APK + tell any internal testers to update. The Phase
C/D back-compat machinery below is struck out accordingly.

## Naming map
| Old | New |
|---|---|
| `model Summary` | `model Insight` |
| `Summary.reportType` | `Insight.insightType` |
| `User.summaries` (relation) | `User.insights` |
| `prisma.summary.*` | `prisma.insight.*` |
| `src/summary/` (dir) | `src/insight/` |
| `summaryQueue` (TS symbol) | `insightQueue` |
| API `/api/v1/summary/*` | `/api/v1/insights/*` (alias old paths, deprecated) |
| JSON `summaryId` | `insightId` |
| JSON `reportType` / `lastReport.type` | `insightType` / `lastInsight.type` |

Unchanged: the two type *values* `sessionbridge` / `myself_lately`; user-facing
button labels "SessionBridge" / "Myself, Lately".

---

## Phase A — Database (clean recreate) ✅ DONE 2026-06-23
Migration `20260623120000_rename_summary_to_insight` applied (drop+create). Schema
renamed (model Insight, User.insights, insightType, insightText). `prisma generate`
done; `migrate diff` reports no drift. TS build now red until Phase B.

### Phase A — original notes (for reference)
PRECONDITION (confirmed 2026-06-23): WhatsApp support is **beta only**; it is
acceptable to **lose all currently generated reports, even in prod**. So NO data
migration — drop the old table and create `Insight` fresh.
1. Edit `prisma/schema.prisma`: `model Summary` → `model Insight`; `reportType` →
   `insightType`; relation `User.summaries` → `User.insights`.
2. `pnpm prisma migrate dev` — let Prisma generate the normal DROP+CREATE migration.
   No hand-editing, no RENAME, no index/constraint juggling. Destructive is fine.
3. `pnpm prisma generate`. Verify `prisma.insight` on the client.
- Since we have a clean slate, also tidy field names while here IF obviously worth
  it (but keep scope tight — S3 stays out; don't redesign the pipeline).

## Phase B — Internal code rename ✅ DONE 2026-06-23
`pnpm build` + `tsc --noEmit` both green. Done: `prisma.summary`→`prisma.insight`;
columns `reportType`→`insightType`, `summaryText`→`insightText`; type
`ReportType`→`InsightType` (+ `VALID_INSIGHT_TYPES`, `isInsightType`,
`INSIGHT_HTML_FILE`); payload/var `reportType`→`insightType`; dir
`src/summary/`→`src/insight/` (git mv) with all imports + package.json + Dockerfile
asset paths; `summaryQueue.ts`→`insightQueue.ts`, symbol `summaryQueue`→`insightQueue`;
redis key HELPER fns + `clearInsightArtifactsForUser` renamed.
RESIDUALS (deliberate): (1) Redis key STRINGS + BullMQ queue NAME string kept frozen
→ no orphaning, no drain needed; internal-only "summary:*" wire strings remain for a
future cleanup. (2) External HTTP API untouched (Phase C): route paths `/summary/*`,
param `summaryId`, response key `reportType`, request field `type`. (3) Sub-CLAUDE.md
docs under src/insight still say "summary" (Phase E).

### Phase B — original notes (for reference)
4. `prisma.summary.*` → `prisma.insight.*` — worker.ts (8), summaryHandler.ts (3),
   accountHandler.ts (2), clear.ts (1), stats.ts (1).
5. `reportType` field reads/writes → `insightType` — worker.ts, stats.ts,
   accountHandler (`lastReport`), summaryHandler, `llm/classify/ackClassify.ts`,
   `summary/redisArtifacts.ts`, `summary/types.ts`.
6. Rename dir `src/summary/` → `src/insight/`; fix all imports. (Big diff but
   mechanical.) Update build-copy paths in `package.json`/build script that copy
   `src/summary/template`, `src/summary/prompts`.
7. Queue (`src/queues/summaryQueue.ts`): full rename — TS symbol → `insightQueue`
   AND the BullMQ queue *name string* → `insight`. Renaming the queue name orphans
   any in-flight job at the deploy instant. Handle by **draining the queue on
   deploy** (stop producers, let worker finish, then deploy) — NOT by freezing the
   name. Freezing leaves a "summary" island the next reader trips on.
8. Redis keys (`summary/keys.ts`, `redisArtifacts.ts`): rename key prefixes to
   `insight:*` too. Same drain-on-deploy handling covers in-flight artifacts; a
   low-traffic deploy window makes transient loss negligible. Full rename, no island.

## Phase C — API surface ✅ DONE 2026-06-23
Build green; both OpenAPI specs regenerated (`docs/openapi.yaml` +
`../docs/specs/openapi.yaml`). Done: routes `/summary/*`→`/insights/*`, param
`summaryId`→`insightId`, response keys `summaryId`→`insightId` &
`reportType`→`insightType` & `lastReport`→`lastInsight`, OpenAPI tag
`Summary`→`Insights`; handler file `summaryHandler.ts`→`insightHandler.ts` + fns
`handleGenerate/Get/GetPdfSummary`→`...Insight`; `src/api/CLAUDE.md` table updated.
Request body field `type` unchanged. RESIDUAL: internal BullMQ payload field still
named `summaryId` (frozen worker contract) — fold into future queue-string cleanup.
**The Android app now breaks until Phase D** (calls `/summary/*`, reads
`reportType`/`lastReport`).

### Residual sweep ✅ DONE 2026-06-23
All internal islands eliminated (build green). Tier1: payload field
`summaryId`→`insightId`, type/fn/const symbols (`GenerateInsightPayload`,
`InsightPipelineResult`, `writeInsightArtifact`, `JOB_NAME_GENERATE_INSIGHT`,
`INSIGHT_QUEUE_NAME`, `INSIGHT_*` consts), swagger tag, `/debug/enqueue-insight`.
Tier2 wire strings: queue `"insight"`, job `"generateInsight"`, redis `insight:*`,
WhatsApp button ids `insight_range_*`/`insight_type_*`. Tier3: LLM decision field
`shouldGenerateSummary`→`shouldGenerateInsight` in type + prompt + examples, parser
kept BACKWARD-COMPATIBLE (still accepts legacy `shouldGenerateSummary`/
`shouldGenerateReport`). Stale `src/summary/` path comments fixed.
DELIBERATE KEEPS: `Message.category` value `"summary_request"` (DB data);
user-facing WA caption "Your summary is ready."; conceptual prose comments (→ Phase E).
⚠️ SMOKE-TEST the WhatsApp "generate my summary" flow once (LLM field renamed, no
test framework to catch regressions).

### Phase C — original notes (for reference)
9. Routes in `rest/router.ts`: rename `/api/v1/summary/*` →
   `/api/v1/insights/generate`, `/insights/:id`, `/insights/:id/pdf`. Hard rename,
   no aliases (precondition: no published installs).
10. JSON field renames in responses: `summaryId`→`insightId`,
    `reportType`→`insightType`, `lastReport`→`lastInsight`. Keep request body
    `{type, range}` (the type *values* don't change).
11. Regenerate OpenAPI (`scripts/generateOpenApi.ts`), bump version. Sync
    `docs/openapi.yaml` and canonical `../docs/specs/openapi.yaml`.

## Phase D — Android app ✅ DONE 2026-06-23
Full client rename (user chose zero-islands, not just wire fix). `./gradlew
compileDebugKotlin` BUILD SUCCESSFUL; no stray old identifiers. Wire layer:
endpoints `/insights/*`, DTO fields `insightId`/`insightType`. Classes/files:
`SummaryApi`→`InsightApi`, `Report`→`Insight`, `ReportStatus`→`InsightStatus`,
`*Repository`→`Insight*`, `ReportsScreen/ViewModel`→`Insights*`, DTOs renamed;
package `ui.reports`→`ui.insights`; DI + NavGraph + Screen route `"reports"`→
`"insights"` + ChatScreen callback updated. User-visible labels "Report"→"Insight"
(SessionBridge/Myself-Lately preserved). Left: local cache subdir literal "reports"
(harmless). APK rebuild + tester install is the only manual step left.

>>> RENAME COMPLETE (all phases A,B,C,residual,E,D done 2026-06-23). Remaining
manual: smoke-test WhatsApp "generate my summary" flow; rebuild+ship APK to testers.

### Phase D — original notes (for reference)
12. App PR: Retrofit endpoints `/summary/*`→`/insights/*`, DTO fields
    `summaryId`/`reportType`→`insightId`/`insightType`, `lastReport`→`lastInsight`.
13. Rebuild APK; tell any internal testers to install it. No drain telemetry, no
    alias retirement — there are no old installs in the wild.

## Phase E — Docs & cleanup ✅ DONE 2026-06-23
Swept architecture/design docs to Insight names: root CLAUDE.md, src/insight/*
CLAUDE.md (titles+paths), src/api/CLAUDE.md, src/llm/CLAUDE.md, docs/tech-design.md,
docs/response.md, README.md. Deliberately LEFT: LLM prompt templates (summary/report
is user-intent prose), src/guides/user_guide.md (product-facing), ADR-0001
(historical), `Message.category` value `summary_request` (DB data),
docs/test/ack-reply-checklist.md (test artifact, parser back-compat). Prompt
templates confirmed content-unchanged (pure git-mv renames from Phase B).
ONLY PHASE D (Android app) REMAINS.

### Phase E — original notes (for reference)
14. Update `CLAUDE.md`, `src/api/CLAUDE.md`, `src/insight/CLAUDE.md` (renamed),
    `docs/tech-design.md`, `docs/response.md`, `README.md`. Leave prompt `.md` files
    that say "summary" in the natural-language sense (not the model).
15. CONTEXT.md already carries `Insight` (done 2026-06-23). Consider a short
    ADR-0004 "Insight is the artifact umbrella" (precedent: ADR-0001 product-language
    rename).

---

## Rollout order (lockstep, no zero-downtime machinery)
1. Phase A+B+C on a backend branch → deploy backend (hard cutover to `/insights/*`;
   old reports dropped — acceptable per precondition).
2. Phase D app rebuild → testers install the new APK.
3. THEN branch coach-support off the renamed code.

## Settled choices (2026-06-23)
- Rename `src/summary/` dir → `src/insight/`. YES.
- Write ADR-0004 "Insight is the artifact umbrella". YES → `docs/adr/0004-*`.
- No data migration — drop + recreate (WhatsApp beta, report loss acceptable).
- No API back-compat / aliases (app pre-production).

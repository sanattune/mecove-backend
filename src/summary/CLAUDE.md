# Summary Pipeline (`src/summary/`)

Multi-stage LLM pipeline that transforms user message logs into a structured PDF report. Two report types share the L1 canonicalizer and diverge at L2.

## Report types

- `sessionbridge` — factual **therapist/coach brief** (default). Structured data export: vocabulary table, ongoing themes, open questions, decisions/options, plus an appendix daily log. No interpretation.
- `myself_lately` — **"Myself, Lately"** self-reflection recap. Second-person opener + three lists: Patterns you kept recording · Moments worth noticing · Worth flagging.

Selected by `reportType` on `GenerateSummaryPayload` (queue) and on `generateSummaryPipeline()` input. Persisted on `Summary.reportType` (schema has default `"sessionbridge"`).

## Stages

1. **L1_CANONICALIZER** — normalizes raw user messages into per-day structured facts, emotion vocabulary, and numeric logs. Used by both report types. Emits `sourceSnippet` values as complete quotable fragments (5–30 words, never mid-sentence).
2. Branches on `reportType`:
   - **sessionbridge**:
     - **L2_SESSIONBRIDGE_BRIEF** — produces `DraftSessionBridge` (vocabulary, ongoingThemes, openQuestions, decisions, dailyLog)
     - **L3_SESSIONBRIDGE_GUARDFIX** — enforces schema/date-format/pronoun rules; produces `FinalSessionBridge`
   - **myself_lately**:
     - **L2_MIRROR_RECAP** — opener sentence + 3 lists of anchor+body entries; produces `MirrorDraft`
     - **L3_MIRROR_GUARDFIX** — strips interpretation/arc framing; produces `FinalMirror`

Each stage is JSON-validated with retry on failure. Stage outputs are persisted to Redis artifacts (24h TTL).

## Prompts

All prompt templates live in `src/summary/prompts/` as `.md` files — editable by non-technical team members. Placeholders use `{{NAME}}` syntax and are substituted at runtime by `promptLoader.ts` (missing values throw).

- `canonicalizer.md`
- `sessionbridge-brief.md` / `sessionbridge-guardfix.md`
- `mirror-recap.md` / `mirror-guardfix.md`

Prompt versions are tracked in `prompts.ts#PROMPT_VERSIONS` and surfaced in `Summary.promptVersion`. Bump versions when prompt content meaningfully changes.

**Date format** — everywhere in both reports: `Month D` (e.g. `April 5`, `March 12`). Month in words, day in numbers, no leading zero, no year. Vocabulary contexts use short `(Mon D)` abbreviation.

## Key Files

- `pipeline.ts` — orchestrator; branches on `reportType` after L1; normalizes `FinalMirror` length caps before rendering
- `stageRunner.ts` — generic JSON stage executor with validation + retry
- `promptLoader.ts` — loads `.md` prompts, substitutes `{{PLACEHOLDER}}` tokens
- `prompts.ts` — thin builder wrappers calling `renderPrompt`; holds `PROMPT_VERSIONS`
- `types.ts` — `WindowBundle`, `CanonicalDoc`, SessionBridge shapes (`VocabularyEntry`, `OngoingTheme`, `OpenQuestion`, `DecisionItem`, `DailyLogBlock`, `DraftSessionBridge`, `FinalSessionBridge`), Mirror shapes (`MirrorEntry`, `MirrorDraft`, `FinalMirror`), `ReportType`, discriminated-union `SummaryPipelineResult`
- `validation.ts` — type guards for every draft/final shape
- `windowBuilder.ts` — assembles `WindowBundle` from encrypted messages with timezone handling
- `redisArtifacts.ts` — persists pipeline outputs to Redis
- `reportAssembler.ts` — markdown assemblers + `renderReportPdf` / `renderMirrorReportPdf`
- `reportHtml.ts` — `buildHtmlReport` (sessionbridge) and `buildMirrorHtmlReport`; table + list + appendix helpers
- `templateLoader.ts` — `loadReportHtml(reportType)` picks the correct template
- `keys.ts` — Redis key helpers: `summaryLockKey`, `summaryRangePromptKey`, `summaryTypePromptKey`, `summaryChosenTypeKey`

## PDF Generation

Template files in `template/`:
- `sessionbridge-report.html` — five-section brief (vocabulary table, themes, questions, decisions, appendix daily log)
- `myself-lately-report.html` — opener + three-list mirror
- `styles.css` — shared styling; includes `.vocab-table`, `.simple-list`, `.section-41.appendix` (small-font) classes

Flow: `reportAssembler.ts` → `reportHtml.ts` (builds HTML) → `infra/pdf.ts` (Puppeteer renders to PDF).

## Button flow (WhatsApp)

Summary intent triggers a two-step button gate before enqueuing:

1. `handleSummaryIntent` (worker) sets `summaryTypePromptKey` and sends type buttons: "Activity report" / "Myself, lately".
2. User press → server stores choice in `summaryChosenTypeKey`, sets `summaryRangePromptKey`, sends range buttons (7/15/30 days).
3. User press → server reads `summaryChosenTypeKey`, enqueues `GenerateSummaryPayload { range, reportType }`.

## Fixture CLI

`pnpm report:fixture <fixture-dir> [--days 15] [--end-date YYYY-MM-DD] [--report-type sessionbridge|myself_lately]`

- Omit `--report-type` → generates BOTH reports in one run.
- Output layout: PDFs at persona root (`sessionbridge.pdf`, `myself-lately.pdf`). All other artifacts (`.md`, `-meta.json`, per-stage JSON) go under `<persona>/supporting/`.
- Runs the full pipeline against a persona chatlog. No DB, no WhatsApp — primary loop for prompt tuning.

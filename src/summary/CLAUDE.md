# Summary Pipeline (`src/summary/`)

Multi-stage LLM pipeline that turns user message logs into a structured PDF report. Two report types share the L1 canonicalizer and diverge at L2.

## Report types

- `sessionbridge` — factual **therapist/coach brief** (default). See `sessionbridge/CLAUDE.md`.
- `myself_lately` — **"Myself, Lately"** self-reflection recap. See `myself-lately/CLAUDE.md`.

Selected by `reportType` on `GenerateSummaryPayload` (queue) and on `generateSummaryPipeline()` input. Persisted on `Summary.reportType`.

## Layout

```
src/summary/
  CLAUDE.md                    # you are here
  pipeline.ts                  # orchestrator; branches on reportType after L1
  types.ts                     # shared types (WindowBundle, CanonicalDoc, ReportType, SummaryPipelineResult)
  validation.ts                # shared type-guard helpers + canonical validator
  prompts.ts                   # canonicalizer builder + PROMPT_VERSIONS
  promptLoader.ts              # .md template loader with {{PLACEHOLDER}} substitution
  stageRunner.ts               # generic JSON stage executor (validation + retry)
  redisArtifacts.ts            # per-stage artifact persistence (24h TTL)
  windowBuilder.ts             # assembles WindowBundle from encrypted messages
  templateLoader.ts            # picks the right HTML template file
  keys.ts                      # Redis key helpers (lock, type-prompt, range-prompt, chosen-type)
  reportHtml.ts                # SHARED HTML helpers (escape, curly quotes, anchor row, formatters)
  prompts/                     # LLM prompt templates as .md (editable by non-tech). See prompts/CLAUDE.md.
    canonicalizer.md
    sessionbridge/{brief,guardfix}.md
    myself-lately/{recap,guardfix}.md
  template/                    # HTML templates + shared CSS
    sessionbridge-report.html
    myself-lately-report.html
    styles.css
    images/
  sessionbridge/               # SessionBridge-specific code. See sessionbridge/CLAUDE.md.
    CLAUDE.md
    types.ts / validation.ts / prompts.ts / html.ts / assembler.ts
  myself-lately/               # "Myself, Lately"-specific code. See myself-lately/CLAUDE.md.
    CLAUDE.md
    types.ts / validation.ts / prompts.ts / html.ts / assembler.ts
```

## Pipeline stages

1. **L1_CANONICALIZER** (shared) — normalizes raw user messages into per-day structured facts, emotion vocabulary, and numeric logs. Emits `sourceSnippet` values as complete quotable fragments (5–30 words, never mid-sentence).
2. Branches on `reportType`:
   - `sessionbridge` → **L2_SESSIONBRIDGE_BRIEF** → **L3_SESSIONBRIDGE_GUARDFIX**
   - `myself_lately` → **L2_MIRROR_RECAP** → **L3_MIRROR_GUARDFIX**

Each stage is JSON-validated with retry on failure. Outputs persisted to Redis (24h TTL).

## Date format

All dates in both reports render as `Month D` (e.g. `April 5`, `March 12`). Month in words, day in numbers, no leading zero, no year. Vocabulary contexts use short `(Mon D)` abbreviation.

## PDF generation

`<report>/assembler.ts` → `<report>/html.ts` (builds self-contained HTML using shared helpers from `reportHtml.ts` + template files from `template/`) → `infra/pdf.ts` (Puppeteer renders to PDF).

## Button flow (WhatsApp)

Summary intent triggers a two-step button gate before enqueuing:

1. `handleSummaryIntent` (worker) sets `summaryTypePromptKey` and sends type buttons: "Activity report" / "Myself, lately".
2. User press → server stores choice in `summaryChosenTypeKey`, sets `summaryRangePromptKey`, sends range buttons (7/15/30 days).
3. User press → server reads `summaryChosenTypeKey`, enqueues `GenerateSummaryPayload { range, reportType }`.

## Fixture CLI

`pnpm report:fixture <fixture-dir> [--days 15] [--end-date YYYY-MM-DD] [--report-type sessionbridge|myself_lately]`

- Omit `--report-type` → generates BOTH reports in one run.
- Output layout: PDFs at persona root (`sessionbridge.pdf`, `myself-lately.pdf`). All other artifacts (`.md`, `-meta.json`, per-stage JSON) go under `<persona>/supporting/`.
- Primary loop for prompt tuning. No DB, no WhatsApp.

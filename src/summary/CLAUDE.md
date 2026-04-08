# Summary Pipeline (`src/summary/`)

Multi-stage LLM pipeline that transforms user message logs into a structured PDF report.

## Stages

1. **L1_CANONICALIZER** — normalizes raw logs into structured facts, emotions, and numeric data
2. **L2A_WRITER_S2_S3** — drafts Sections 2 (Observed Patterns) and 3 (Open Points for Reflection)
3. **L2B_WRITER_S4** — drafts Section 4 (Logged Moments) with date-labeled journal entries
4. **L3_GUARDFIX** — final validation/correction; applies guardrails and produces final output

Each stage is JSON-validated with retry on failure.

## Key Files

- `pipeline.ts` — main orchestrator; chains stages, logs latency, handles errors
- `stageRunner.ts` — generic JSON stage executor with validation and retry
- `prompts.ts` — builds prompts for each stage (v3)
- `types.ts` — TypeScript interfaces: `WindowBundle`, `CanonicalDoc`, `DraftS2S3`, `DraftS4`, `FinalSections`
- `validation.ts` — type guards and section rule validators
- `windowBuilder.ts` — assembles input `WindowBundle` from encrypted messages with timezone handling
- `redisArtifacts.ts` — persists pipeline outputs to Redis with 24h TTL
- `reportAssembler.ts` — calls `buildHtmlReport()` and `renderReportPdf()` for final PDF
- `reportHtml.ts` — builds HTML from final sections using template

## PDF Generation

`reportAssembler.ts` → `reportHtml.ts` (builds HTML) → `infra/pdf.ts` (Puppeteer renders to PDF). Template files in `template/` (HTML, CSS, images).

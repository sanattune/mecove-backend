# SessionBridge Brief (`src/summary/sessionbridge/`)

Factual {{N}}-day therapist/coach data export. NO interpretation, NO advice, NO prose conclusions — every field maps to something in canonical. Structured for scan-reading before or during a session.

## Sections (in render order)

1. **Time window & scope** — rendered from shared header.
2. **Recorded vocabulary** — HTML table of emotion/state words the person used: `word · count · usage contexts with dates`.
3. **Ongoing themes** — plain list sorted highest day-count first; label + `(N days)`.
4. **Open questions** — sentences the user asked themselves (end with `?`), verbatim, with date anchors.
5. **Decisions & options considered** — decisions/plans/options the user named, verbatim-ish, with dates.
6. **Appendix · Daily log** — smaller font; one block per logged day with short bullet fragments.

## Files

- `types.ts` — `VocabularyEntry`, `OngoingTheme`, `OpenQuestion`, `DecisionItem`, `DailyLogBlock`, `DraftSessionBridge`, `FinalSessionBridge`
- `validation.ts` — `isDraftSessionBridge`, `isFinalSessionBridge` type guards
- `prompts.ts` — `buildSessionBridgeBriefPrompt`, `buildSessionBridgeGuardfixPrompt`; loads `.md` templates from `../prompts/sessionbridge/`
- `html.ts` — `buildSessionBridgeHtmlReport` + section renderers (table, lists, daily log appendix)
- `assembler.ts` — `assembleSessionBridgeReport` (markdown), `renderSessionBridgePdf` (Puppeteer), `buildMinimalFallbackReport` (emergency path if pipeline fails)

## Pipeline stages

- **L2_SESSIONBRIDGE_BRIEF** — produces `DraftSessionBridge` from canonical.
- **L3_SESSIONBRIDGE_GUARDFIX** — enforces schema/date-format/pronoun rules; produces `FinalSessionBridge`.

## Date format

All dates render as `Month D` (e.g. `April 5`). Vocabulary contexts append `(Mon D)` with 3-letter month abbreviation.

## Fallback path

If the full pipeline fails, `buildMinimalFallbackReport` assembles a bare-bones brief directly from raw window messages (daily log only, no vocabulary/themes/etc). Worker uses this when `generateSummaryPipeline` throws.

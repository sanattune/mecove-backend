# SessionBridge Brief (`src/summary/sessionbridge/`)

Factual {{N}}-day therapist/coach data export. NO interpretation, NO advice, NO prose conclusions — every field maps to something in canonical. Structured for scan-reading before or during a session.

## Sections (in render order)

1. **Time Window & Scope** — rendered from shared header.
2. **Observed Themes** — topical recurrences only (work, sleep, family); plain list sorted highest day-count first; label + `(N days)`.
3. **Signals Worth Attention** — recurring INTERNAL states as observational sentences (not labels). Repetition-based, no diagnosis. `string[]`.
4. **Moments of Variation** — date-anchored entries showing positive-affect or contrasting moments (music, curiosity, enjoyment, relief, self-expression). `{date, quote, context}`.
5. **Open Questions** — sentences the user asked themselves (end with `?`), verbatim, with date anchors.
6. **Decisions / Intentions** — decisions, plans, options, named intentions; verbatim-ish, with dates.
7. **Words Used in Context** — compact two-column table of `{statement, reflects}`. The `reflects` column carries the user's own emotion word only if they wrote one in or near that statement; null otherwise.
8. **Appendix · Daily Log** — smaller font; one block per logged day with short bullet fragments.

## Files

- `types.ts` — `WordInContext`, `ObservedTheme`, `MomentOfVariation`, `OpenQuestion`, `DecisionItem`, `DailyLogBlock`, `DraftSessionBridge`, `FinalSessionBridge`
- `validation.ts` — `isDraftSessionBridge`, `isFinalSessionBridge` type guards
- `prompts.ts` — `buildSessionBridgeBriefPrompt`, `buildSessionBridgeGuardfixPrompt`; loads `.md` templates from `../prompts/sessionbridge/`
- `html.ts` — `buildSessionBridgeHtmlReport` + section renderers (themes list, signals list, variation rows, table, daily log appendix)
- `assembler.ts` — `assembleSessionBridgeReport` (markdown), `renderSessionBridgePdf` (Puppeteer), `buildMinimalFallbackReport` (emergency path if pipeline fails)

## Pipeline stages

- **L2_SESSIONBRIDGE_BRIEF** — produces `DraftSessionBridge` from canonical. The L2 prompt does the topical-vs-internal-state partition of `repeatCandidates` and selects positive-affect emotions for Moments of Variation (see ADR-0002).
- **L3_SESSIONBRIDGE_GUARDFIX** — enforces schema/date/pronoun rules, rewrites tone violations (clinical labels, standalone emotion words, diagnostic verbs); produces `FinalSessionBridge`.

## Date format

All dates render as `Month D` (e.g. `April 5`). Month in words, day in numbers, no leading zero, no year.

## Fallback path

If the full pipeline fails, `buildMinimalFallbackReport` assembles a bare-bones brief directly from raw window messages (daily log only, no themes/signals/variation/words). Worker uses this when `generateSummaryPipeline` throws.

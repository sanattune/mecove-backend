# Myself, Lately (`src/insight/myself-lately/`)

Second-person self-reflection recap. Soft, observational, quote-heavy. Five sections in render order: opener, what-has-been-coming-up, moments-that-stood-out, something-to-notice, gentle-takeaway. No interpretation, no diagnosis, no advice.

## Sections

1. **Opener sentence** — one factual sentence naming the surface shape of the window.
2. **What Has Been Coming Up** — `string[]` of reflective sentences (no labels, no anchors). Each sentence describes something that recurred across multiple days, phrased observationally rather than categorically.
3. **Moments That Stood Out** — `MomentEntry[]` (`{anchor, body}`). Anchor is a date in `Month D` format; body is one or two soft sentences with at least one verbatim quote.
4. **Something to Notice** — `string[]` of reflective sentences pointing at recurrence in soft language. Replaces the older "Worth Flagging" name and tone.
5. **Gentle Takeaway** — single closing sentence. Prefers a contrast pattern; falls back to a gentle observation. Empty under the sparse-data rule.

## Files

- `types.ts` — `MomentEntry`, `MirrorDraft`, `FinalMirror`
- `validation.ts` — `isMirrorDraft`, `isFinalMirror` type guards
- `prompts.ts` — `buildMirrorRecapPrompt`, `buildMirrorGuardfixPrompt`; loads from `../prompts/myself-lately/`
- `html.ts` — `buildMirrorHtmlReport` + section/entry/opener/takeaway renderers
- `assembler.ts` — `assembleMirrorReport` (markdown), `renderMirrorPdf` (Puppeteer), `normalizeFinalMirror` (deterministic caps: whatHasBeenComingUp ≤5, momentsThatStoodOut ≤4, somethingToNotice ≤4)

## Pipeline stages

- **L2_MIRROR_RECAP** — produces `MirrorDraft` from canonical.
- **L3_MIRROR_GUARDFIX** — strips clinical labels, standalone emotion words, diagnostic verbs, arc/metaphor language; rewrites pattern-as-label entries into reflective sentences; produces `FinalMirror`.

## Date format

All dates render as `Month D` (e.g. `April 17`). Month in words, day in numbers, no leading zero, no year.

## Sparse-data rule

If fewer than 4 days logged in the window, the recap returns only the opener sentence; `whatHasBeenComingUp`, `momentsThatStoodOut`, `somethingToNotice` are empty arrays and `gentleTakeaway` is an empty string.

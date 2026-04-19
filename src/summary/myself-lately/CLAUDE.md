# Myself, Lately (`src/summary/myself-lately/`)

Second-person self-reflection recap. One factual opener sentence + three lists. Quote-heavy (uses the person's own words), no interpretation, no arc narration.

## Sections

1. **Opener sentence** — one factual sentence naming the surface shape of the window (e.g. "11 of 15 days logged. Entries cluster around…").
2. **Patterns you kept recording** — anchors + body; each item describes something that appeared on MULTIPLE days.
3. **Moments worth noticing** — anchors are dates; each item a specific first, shift, or named action.
4. **Worth flagging** — recurring things heavy enough to bring to a therapist/coach.

Each list item shape: `{ anchor, body }`. Anchors render in green, bodies in black. Double quotes render as curly.

## Files

- `types.ts` — `MirrorEntry`, `MirrorDraft`, `FinalMirror`
- `validation.ts` — `isMirrorDraft`, `isFinalMirror` type guards
- `prompts.ts` — `buildMirrorRecapPrompt`, `buildMirrorGuardfixPrompt`; loads from `../prompts/myself-lately/`
- `html.ts` — `buildMirrorHtmlReport` + section/entry/opener renderers
- `assembler.ts` — `assembleMirrorReport` (markdown), `renderMirrorPdf` (Puppeteer), `normalizeFinalMirror` (deterministic caps: patterns ≤5, moments ≤4, flags ≤4)

## Pipeline stages

- **L2_MIRROR_RECAP** — produces `MirrorDraft` from canonical.
- **L3_MIRROR_GUARDFIX** — strips interpretation, arc language, metaphor verbs; produces `FinalMirror`.

## Date format

All dates render as `Month D` (e.g. `April 17`). Month in words, day in numbers, no leading zero, no year.

## Sparse-data rule

If fewer than 4 days logged in the window, the recap returns only the opener sentence and empty lists — enforced in the prompt.

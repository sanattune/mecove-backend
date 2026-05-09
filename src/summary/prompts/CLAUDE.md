# Prompts (`src/summary/prompts/`)

LLM prompt templates used by the report pipeline, stored as plain `.md` files so non-engineers can review and edit them. Every prompt is loaded at runtime by `../promptLoader.ts` — no re-deploy needed after content edits (though version bumps in `../prompts.ts#PROMPT_VERSIONS` are a deliberate code change).

## Layout

```
prompts/
  canonicalizer.md              # shared by both report types (L1)
  sessionbridge/
    brief.md                    # L2_SESSIONBRIDGE_BRIEF
    guardfix.md                 # L3_SESSIONBRIDGE_GUARDFIX
  myself-lately/
    recap.md                    # L2_MIRROR_RECAP
    guardfix.md                 # L3_MIRROR_GUARDFIX
```

## Placeholder syntax

Prompts use `{{UPPER_SNAKE_CASE}}` placeholders. The loader substitutes them at runtime with values from the code. Every placeholder in a template MUST have a matching value — missing placeholders throw a hard error rather than silently producing broken prompts.

Common placeholders:
- `{{WINDOW_DAYS}}` — number of days in the report window (e.g. `15`).
- `{{CANONICAL_JSON}}` — the L1 canonicalizer output, serialized.
- `{{DRAFT_JSON}}` — the L2 stage output, passed to guardfix.
- `{{WINDOW_BUNDLE_JSON}}` — raw input bundle, passed only to the canonicalizer.

## Editing rules

1. **Edit content freely** — wording, rule lists, examples, emphasis.
2. **Keep every `{{PLACEHOLDER}}`** the template already has — removing one breaks the stage.
3. **Keep the JSON output schema at the top of each prompt stable** — it's what the stage validator enforces. If the schema needs to change, the corresponding TypeScript type (`src/summary/<report>/types.ts`) and validator must change too; that's a code-level edit.
4. **Quote user phrasings sparingly in examples** — the prompt is sent to the LLM per report; very long examples cost tokens.
5. **Preserve the "Return JSON only. No markdown. No commentary." lead line** — these prompts always expect JSON back.

## When to bump prompt version

If a content edit meaningfully changes output (tone shift, new rule, new field), bump the relevant entry in `src/summary/prompts.ts#PROMPT_VERSIONS` so generated summaries carry the new version in their metadata. Small wording tweaks don't need a bump.

## How to add a new prompt

1. Add the `.md` file under the right subdirectory.
2. Add its name to `PromptName` in `../promptLoader.ts` (path-form, e.g. `"sessionbridge/my-new-stage"`).
3. Add a builder wrapper in the appropriate report's `prompts.ts`.
4. Add a version entry to `PromptVersions` in `../types.ts` and `PROMPT_VERSIONS` in `../prompts.ts`.

The build step copies this whole folder tree to `dist/summary/prompts/` during `pnpm build`.

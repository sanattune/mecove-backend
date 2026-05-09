# Rename report schema fields to match product language

**Context.** SessionBridge and Myself, Lately reports were renamed in product copy (e.g. "Worth flagging" → "Something to Notice", "Recorded Vocabulary" → "Words Used in Context") to soften clinical connotation. Internal schema fields kept their old names (`worthFlagging`, `vocabulary`, `ongoingThemes`, `decisions`, `patterns`, `moments`).

**Decision.** Rename schema fields to match the new product language end-to-end: TypeScript types, JSON validators, prompt templates, HTML renderers, fixture artifacts. The alternative of heading-only renames was rejected — code that says `worthFlagging` while the report renders "Something to Notice" forces every future reader (and every grep) to translate, and the old name carries the exact clinical alarm we removed from the user-facing copy.

**Consequences.** One-time churn across the report pipeline (types, validators, prompts, html, fixtures). Redis-cached stage drafts (24h TTL) become invalid through deploy — accepted. Past `Summary.summaryText` rows in the database are stored as rendered markdown, not structured JSON, so backfill is unnecessary.

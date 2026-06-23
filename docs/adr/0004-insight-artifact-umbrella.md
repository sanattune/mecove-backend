# "Insight" is the umbrella term for generated artifacts

## Context

The backend generates per-user reports — currently **SessionBridge** (counsellor-
facing) and **Myself, Lately** (self-reflection). In code these live in a single
`Summary` model with a `reportType` discriminator. The word "report" / "summary"
was used inconsistently as the generic name for "a thing the pipeline produced,"
and the professional-support work (sharing artifacts to professionals) needed a precise,
shareable noun. ADR-0001 already moved section/field names to product language;
this continues that line at the model level.

## Decision

**Insight** is the canonical umbrella for any generated artifact. SessionBridge and
Myself, Lately are *types* of Insight. Concretely:

- `model Summary` → `model Insight`; `reportType` → `insightType`.
- The public REST surface moves `/api/v1/summary/*` → `/api/v1/insights/*`, and
  response fields `summaryId`/`reportType`/`lastReport` → `insightId`/`insightType`/
  `lastInsight`.
- "report" and "summary" are retired as generic terms (CONTEXT.md ambiguity flag).
  The proper names SessionBridge / Myself, Lately are unchanged.

This is a **clean rename, not a data-preserving migration**: WhatsApp is beta-only
and losing existing generated reports is acceptable, so the table is dropped and
recreated rather than `ALTER ... RENAME`d.

## Consequences

- The Android app and OpenAPI spec change in lockstep; acceptable because the app
  is pre-production (no published installs), so no deprecated-alias/back-compat
  layer is built.
- New professional-support code (Engagement, InsightShare) is written against `Insight`
  from the start — the rename is sequenced first to avoid reworking new code.
- S3-backed storage is explicitly out of scope here; Insight keeps `pdfBytes` in
  Postgres for now (separate track).
- Renaming the BullMQ queue + Redis key prefixes orphans in-flight jobs at the
  deploy instant; handled by draining on deploy, not by freezing names.

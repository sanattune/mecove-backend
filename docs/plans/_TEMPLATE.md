# Plan — <name>

**Status:** PENDING · **Urgency:** LATER · **Created:** YYYY-MM-DD · **Branch:** `<branch>`

> Copy this file to `docs/plans/plan_<name>.md` and fill it in. Keep every `##`
> heading — fill it or write "none + why". Add a row to `docs/plans/README.md` in
> the same change (a plan not in the tracker does not exist).

## Goal
What this builds and why (2–4 lines).

## Decisions locked
Settled with the user/SME (dated). Not up for debate during implementation.

## Defaults chosen
Choices made without asking, one-line rationale each. Vetoable.

## Architecture fit
Which extension point / pattern / ADR this follows. Name any deviation explicitly —
a deviation or shared-infra touch needs architect sign-off and usually a new ADR.

## Implementation steps
Numbered vertical slice (data → compute → wire → render/output → tests), with exact
filenames. Flag any file expected to exceed ~300 lines.

## Documentation impact (MANDATORY)
Every doc this plan creates/updates — each row a path or an explicit "none + why".
Docs are a deliverable, not an afterthought.
- Tracker row (`docs/plans/README.md`): ALWAYS.
- ADR (`docs/adr/`): <path or none + why>
- CONTEXT.md: <yes/section or none + why>
- Module CLAUDE.md(s): <paths or none + why>
- API spec (`docs/openapi.yaml` + canonical `../docs/specs/openapi.yaml`): <yes or none + why>
- Memory: <yes or none + why>
- Runbooks/other: <paths or none + why>

## Open questions
Unresolved items needing input before/during implementation.

## Risks / watch-items
What could break; how each is settled.

## Verification
Exact command(s)/observation proving it works end-to-end.

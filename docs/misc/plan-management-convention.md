# Plan Management Convention (portable)

Drop-in spec for replicating our `docs/plans/` plan-management system in another repo
using Claude Code. Hand this file to the agent and tell it to set up the same system.

---

## What it is

Three pieces + one binding rule:

1. **Folder** — `docs/plans/` holds every detailed plan doc.
2. **Tracker** — `docs/plans/README.md` is the master status index (one row per plan).
3. **Template** — `docs/plans/_TEMPLATE.md` is the start-point for every new plan.
4. **Binding rule** (lives in repo-root `CLAUDE.md`) — ties them together so nothing drifts.

---

## 1. Folder — `docs/plans/`

- All plan docs live here, named `plan_<name>.md`.
- **Never** create `plan_*.md` at repo root. Always `docs/plans/`.

## 2. Tracker — `docs/plans/README.md`

Master status index. Every plan = one row. **A plan not in the tracker does not exist.**

- Grouped tables: **Active** (open work) · **Done** (no action) · **Superseded/killed** ·
  **Moved** · optional **External prerequisites** (specs you depend on, built elsewhere).
- Columns: `Plan | Status | Urgency | Created | Closed | What's left`.
- **Status**: `DONE` (shipped) · `PARTIAL` (core shipped, tail open) · `PENDING` (not started) ·
  `SUPERSEDED` (killed/absorbed) · `MOVED` (re-homed out of plans/).
- **Urgency**: `NOW` · `LATER` · `FUTURE` · `—` (nothing left to do).
- `Created` = first commit of the plan file. `Closed` = date it reached DONE/SUPERSEDED/MOVED
  (blank while active).
- `What's left` carries running state — what shipped, what's open, key decisions. This is the
  map; full detail lives in the plan file.
- Header carries a `_Last reconciled: YYYY-MM-DD_` line.

## 3. Template — `docs/plans/_TEMPLATE.md`

New plans copy template → fill. Keep every `##` heading — fill it or write "none + why".

- **Status line** — `Status · Urgency · Created · branch`
- **Goal** — what this builds and why, 2-4 lines.
- **Decisions locked** — settled with user/SME (dated); not up for debate during impl.
- **Defaults chosen** — choices made without asking, one-line rationale each, vetoable.
- **Architecture fit** — which extension point / pattern / ADR it follows; name deviations
  explicitly (deviation or shared-infra touch = architect sign-off + usually a new ADR).
- **Implementation steps** — numbered vertical slice (data → compute → wire → render/output →
  tests), exact filenames; flag any file expected to exceed ~300 lines.
- **Documentation impact** (MANDATORY) — checklist enumerating every doc to create/update
  (tracker row ALWAYS, ADR for new pattern, CONTEXT.md, module CLAUDE.md(s), API specs, memory,
  runbooks). Each row gets a path or "none + why". *This section is the reason the template
  exists — docs are a deliverable of the plan, not an afterthought.*
- **Open questions** — unresolved items needing input before/during impl.
- **Risks / watch-items** — what could break; how each is settled.
- **Verification** — exact command(s)/observation proving it works end-to-end.

## 4. Binding rule — paste into repo-root `CLAUDE.md`

```markdown
## Plans convention

Detailed plan documents live in `docs/plans/`. **Never create `plan_*.md` files at the project
root.** When writing a new plan, put it at `docs/plans/plan_<name>.md`.

**Tracker is mandatory.** `docs/plans/README.md` is the master status index of every plan
(Status + Urgency). Whenever you create a new plan, add a row for it to that tracker in the same
change. Whenever a plan's status changes (shipped, superseded, abandoned, moved), update its row.
A plan that is not in the tracker does not exist.

**Use the template.** New plans start from `docs/plans/_TEMPLATE.md` (copy → fill). It carries a
mandatory **Documentation impact** checklist — every plan must enumerate which docs it will
create/update, filling each row with a path or an explicit "none + why". Docs are a deliverable
of the plan, not an afterthought — a plan that ships code but not its docs is not shipped.
```

## 5. Optional — reconcile skill

Consider a `/plan-review` slash-command/skill: walks the tracker one plan at a time, asks the
status of each, updates `README.md` to match. Worth it once a repo accumulates many plans.

---

## Setup checklist for the agent

1. Create `docs/plans/`.
2. Create `docs/plans/README.md` with the grouped tables + Status/Urgency legend + reconciled date.
3. Create `docs/plans/_TEMPLATE.md` with all the `##` headings above (esp. Documentation impact).
4. Add the **Plans convention** block (section 4) to repo-root `CLAUDE.md`.
5. (Optional) Add a `/plan-review` skill.

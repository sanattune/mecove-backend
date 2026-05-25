# cov-done — Verify, commit, push, and close a subtask

**Usage:** `/cov-done COV-YY`

Implementation is complete. Verify the build, commit and push, open a PR, update JIRA, and drop an ADR if the work was architectural.

## JIRA context

- Site: `https://letsattune.atlassian.net`
- Statuses: `Lets Do` → `Doing` → `Done`

## Step 1 — Verify the build

Run the appropriate commands for this repo:

**mecove-android-app:**
```bash
./gradlew assembleDebug
./gradlew test
```

**mecove-backend:**
```bash
pnpm build
pnpm test   # if tests exist
```

If the build fails, stop. Report the error and do not proceed — never commit broken code.

## Step 2 — Check against the tech design

Fetch COV-YY via `getJiraIssue`. Compare the acceptance criteria in the description against what's been built. If something is missing, flag it to the user — either fix it or note the deviation explicitly in the commit and comment.

## Step 3 — Commit and push

Review what will be committed:
```bash
git status
git diff --stat
```

Show the file list to the user. Commit with:
```
feat(COV-YY): <short description>

<optional body — what changed and why, if non-obvious>
```

Example: `feat(COV-78): centralise app theme with token system`

Confirm before committing, then push:
```bash
git push -u origin <branch-name>
```

Confirm before pushing.

## Step 4 — Open a PR

Create a PR on GitHub. The PR title = commit subject line. Body should include:
- One-paragraph summary of what was built
- JIRA subtask link: `https://letsattune.atlassian.net/browse/COV-YY`
- Any notes for the reviewer

Use GitHub CLI if available:
```bash
gh pr create --title "feat(COV-YY): <description>" --body "..."
```

Otherwise provide the URL for the user to open manually.

## Step 5 — Comment on the subtask and close it

Add a comment to COV-YY via `addCommentToJiraIssue`:
- Short commit SHA (e.g. `a1b2c3d`)
- PR link
- One-sentence summary of what was implemented
- Any deviations from the tech design

Then transition COV-YY → Done via `transitionJiraIssue`. Confirm with the user before each write.

## Step 6 — ADR (architectural work only)

If the subtask involved a significant architectural decision — chose a new library, changed a data model, established a pattern others will follow — drop a short ADR.

Save to `docs/adr/NNNN-<slug>.md` where NNNN is the next sequential number. Check existing ADRs for the current highest number. Minimal template:

```markdown
# NNNN — <Decision Title>

**Date:** YYYY-MM-DD
**Status:** Accepted
**Ticket:** COV-YY

## Context
[Why this decision was needed]

## Decision
[What was decided]

## Consequences
[What this means going forward]
```

Commit the ADR in the same commit as the feature, or as a follow-up commit on the same branch before the PR is merged.

Most tickets do NOT need an ADR. Use judgment — when in doubt, skip it.

## What success looks like

- Build passes cleanly
- Code committed and pushed to the feature branch
- PR open on GitHub
- Comment with commit SHA and PR link on COV-YY in JIRA
- COV-YY is in Done status
- ADR written if the work was architectural

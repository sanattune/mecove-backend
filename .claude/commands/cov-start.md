# cov-start — Take a subtask and cut the feature branch

**Usage:** `/cov-start COV-YY`

Pull the subtask's tech design, verify you're in the right repo, and set up the feature branch so implementation can begin.

## JIRA context

- Site: `https://letsattune.atlassian.net`
- Statuses: `Lets Do` → `Doing` → `Done`

## Step 1 — Read the subtask

Fetch the full issue via `getJiraIssue` for COV-YY. Display:
- Summary and parent story key
- Full description — this is the tech design; read it carefully
- Current status

If the subtask is already Doing or Done, warn the user and ask whether to proceed anyway.

## Step 2 — Verify you're in the right repo

Derive the current repo name:
```bash
git remote get-url origin
```
Check that this matches the subtask's label. If there's a mismatch, warn the user — they may have the wrong repo session open.

## Step 3 — Check the working tree

```bash
git status
```
If there are uncommitted changes, warn the user. They should commit or stash before creating a new branch.

## Step 4 — Cut the feature branch

Derive the branch name:
- Format: `feature/COV-YY-short-slug`
- Slug: lowercase, hyphens, max 5 words from the summary
- Example: `feature/COV-78-centralise-app-theme`

Show the branch name to the user and confirm before running:
```bash
git checkout main
git pull origin main
git checkout -b feature/COV-YY-short-slug
```

## Step 5 — Transition subtask → Doing

Use `getTransitionsForJiraIssue` to find the transition ID, then `transitionJiraIssue` to move COV-YY to Doing. Confirm with the user before applying.

## What success looks like

- On a clean feature branch off latest main
- Subtask is In Progress (Doing) in JIRA
- Tech design is displayed and ready to implement

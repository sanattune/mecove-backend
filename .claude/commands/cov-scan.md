# cov-scan — Show the open JIRA work queue for this repo

Show all open JIRA subtasks labelled for the current repo.

## Step 1 — Identify this repo

Run:
```bash
git remote get-url origin
```
Extract the repository name from the URL. Expected values: `mecove-android-app` or `mecove-backend`. Works with both SSH (`git@github.com:sanattune/mecove-android-app.git`) and HTTPS forms.

## Step 2 — Query JIRA

Run the following JQL via `searchJiraIssuesUsingJql`:
```
project = COV AND issuetype = Subtask AND labels = "<repo-name>" AND statusCategory != Done ORDER BY created ASC
```

Request these fields: `summary`, `status`, `parent`, `assignee`, `description`.

## Step 3 — Display the queue

Show a clean table:

| Key | Parent | Status | Summary |
|-----|--------|--------|---------|
| COV-YY | COV-XX | Doing  | [summary] |

If the queue is empty, say so clearly — that's useful information too.

To start work on a subtask, run: `/cov-start COV-YY`

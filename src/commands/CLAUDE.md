# Commands (`src/commands/`)

## Structure

```
src/commands/
  types.ts        — CommandContext, CommandResult types
  registry.ts     — COMMANDS list (name, description, adminOnly), buildHelpText()
  handler.ts      — top-level router: admin gate + dispatch
  user/
    help.ts       — /help
    guide.ts      — /guide
    chatlog.ts    — /chatlog (builds + sends markdown file, includes buildAllTimeChatlogMarkdown)
    clear.ts      — /clear
    stats.ts      — /stats
    privacy.ts    — /privacy
    testFeedback.ts — /f
    checkin.ts    — /checkin
  admin/
    approve.ts    — /approve <phone>
    waitlist.ts   — /waitlist
    revoke.ts     — /revoke <phone>
    users.ts      — /users
    userstats.ts  — /userstats
```

## Adding a new command

1. Create `src/commands/user/<name>.ts` or `src/commands/admin/<name>.ts` exporting a `handle*` function
2. Add an entry to `COMMANDS` in `registry.ts` (sets `adminOnly`, `description`, and `hidden`)
3. Add one line to the `ROUTER` map in `handler.ts`

Nothing else needs to change.

## Types

**`CommandContext`** — passed to every handler:
```ts
{ userId, messageId, channelUserKey, messageText, isAdminUser, command }
```

**`CommandResult`** — returned by every handler:
- `{ kind: "reply"; text: string }` — send text reply + persist to message record
- `{ kind: "reply_no_persist"; text: string }` — send text reply, skip persist (used by `/clear` since it deletes the message)
- `{ kind: "handled" }` — handler managed everything internally (used by `/checkin`)

## Admin gating

`handler.ts` checks `COMMANDS` registry for `adminOnly` and returns `UNKNOWN_COMMAND_TEXT` for non-admin callers. Individual handlers do **not** re-check `isAdminUser`.

## Engagement tiers in `/userstats`

Uses `Message.classifierType = "journal_entry"` (set by the LLM classifier after each batch) to count distinct days with substantive journaling in the last 15 days:
- **Engaged** — 10+ days/15
- **Less engaged** — 1–9 days/15
- **Disconnected** — 0 days/15

Historical messages were backfilled from `category = "user_message"` at migration time.

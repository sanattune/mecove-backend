# Inactivity Nudge (`src/engagement/nudge/`)

Sends a proactive check-in to users who haven't journaled in 3+ days and have no active reminder.

## Eligibility criteria

- User is approved
- No active `UserReminder`
- Last message (excluding `test_feedback` and `summary_request`) is older than 3 days
- Either never nudged, OR last message is more recent than `UserSettings.lastNudgedAt` (reset when they reply)

## Flow

Daily at 4 PM IST (cron `30 10 * * *` UTC), `processNudgeScan()` runs:
1. Fetches eligible users
2. Calls `generateNudgeMessage(userId)` — LLM finds an open thread from recent history, or falls back to a YAML template
3. Sends via WhatsApp
4. Updates `UserSettings.lastNudgedAt = now()`

## Message generation (`nudgeReply.ts`)

Uses `fetchFormattedMessageLines()` from `src/llm/context/messageContext.ts` to build recent context, then calls the LLM to reference an unresolved thread naturally. Falls back to a random flavor from `nudge.yaml` if no history or LLM fails.

## Key files

- `nudgeHandler.ts` — eligibility scan, processNudgeScan()
- `nudgeReply.ts` — LLM-based message with open-thread reference
- `nudge.yaml` — 7 fallback nudge message flavors (copied to dist/ at build time)

# Check-in Reminders (`src/engagement/checkin/`)

Handles the `/checkin` command flow and daily reminder delivery.

## Flow

1. User sends `/checkin` (or NL intent `setup_checkin` via classifier)
2. `handler.ts:handleCheckinIntent()` sends WhatsApp interactive buttons and sets a Redis pending key (`checkin:pending:v1:{userId}`, 10 min TTL)
3. User taps a time button — `server.ts` intercepts via the checkin gate (before the text guard), calls `handler.ts:setCheckinReminder()` or `turnOffCheckinReminder()`
4. `setCheckinReminder()` deactivates existing reminders, creates a new `UserReminder` row with `nextFireAt` computed via `computeNextFireAt()`

## Button logic

- No active reminder → 3 buttons: 6 AM / 4 PM / 9 PM
- Has active reminder (e.g. 4 PM) → 2 remaining times + "Turn Off"
- Action IDs: `checkin_time_0600`, `checkin_time_1600`, `checkin_time_2100`, `checkin_off`

## Scheduler

`scheduler.ts:startReminderScheduler()` registers a BullMQ repeatable job (every 60s) on the `reminderQueue`. `processReminderScan()` queries `UserReminder WHERE nextFireAt <= NOW() AND isActive = true`, sends a random message from `checkin.yaml`, and updates `nextFireAt` to the next occurrence.

`startNudgeScheduler()` registers a daily cron job at 10:30 UTC (4 PM IST) for inactivity nudges — also on the `reminderQueue`.

## `computeNextFireAt(time, timezone)`

Pure function — returns the next UTC DateTime for a `"HH:MM"` wall-clock time in a given IANA timezone. Uses `Intl` (no external deps). If the time has already passed today (+ 60s buffer), advances by 24h. Currently all users are `"Asia/Kolkata"` (no DST). Add `luxon` if multi-timezone support is needed.

## Key files

- `handler.ts` — button logic, setCheckinReminder, turnOffCheckinReminder, computeNextFireAt
- `../scheduler.ts` — processReminderScan, startReminderScheduler, startNudgeScheduler (shared with nudge)
- `messages.ts` — loads checkin.yaml, exports pickCheckinMessage()
- `checkin.yaml` — 7 check-in message flavors (copied to dist/ at build time)

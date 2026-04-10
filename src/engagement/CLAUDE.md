# Engagement (`src/engagement/`)

Proactive outreach features — all scheduled, user-initiated or system-triggered messages that aren't direct replies to incoming messages.

## Structure

```
src/engagement/
  scheduler.ts      — shared BullMQ job registration (reminder scan + nudge cron)
  checkin/          — /checkin command flow + daily reminder delivery
  nudge/            — inactivity nudge (3-day silence detection)
```

## Shared scheduler (`scheduler.ts`)

Both features share the `reminderQueue`. Two repeatable jobs are registered at worker startup:
- `scanReminders` — every 60s, delivers due `UserReminder` rows
- `scanNudges` — daily cron at 10:30 UTC (4 PM IST), sends inactivity nudges

New engagement features should add their jobs here and dispatch from the `reminderWorker` in `worker.ts`.

## Adding a new engagement feature

1. Create a subfolder (e.g. `src/engagement/streak/`)
2. Add a new `JOB_NAME_*` to `src/queues/reminderQueue.ts`
3. Register the job in `scheduler.ts`
4. Add a dispatch branch in the `reminderWorker` in `worker.ts`

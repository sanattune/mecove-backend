import { Queue } from "bullmq";
import { getRedis } from "../infra/redis";

export const REMINDER_QUEUE_NAME = "reminder";
export const JOB_NAME_SCAN_REMINDERS = "scanReminders";
export const JOB_NAME_SCAN_NUDGES = "scanNudges";

export type ScanRemindersPayload = Record<string, never>;

export const reminderQueue = new Queue<ScanRemindersPayload>(REMINDER_QUEUE_NAME, {
  connection: getRedis(),
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

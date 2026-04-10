import type { Queue } from "bullmq";
import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { sendWhatsAppReply } from "../infra/whatsapp";
import {
  JOB_NAME_SCAN_REMINDERS,
  JOB_NAME_SCAN_NUDGES,
  type ScanRemindersPayload,
} from "../queues/reminderQueue";
import { computeNextFireAt } from "./handler";
import { pickCheckinMessage } from "./messages";

const REMINDER_SCAN_INTERVAL_MS = 60_000;

/**
 * Register the repeating reminder scan job (every 60s).
 * BullMQ deduplicates repeatable jobs by key — safe to call on every worker restart.
 */
export async function startReminderScheduler(
  queue: Queue<ScanRemindersPayload>
): Promise<void> {
  await queue.add(
    JOB_NAME_SCAN_REMINDERS,
    {},
    { repeat: { every: REMINDER_SCAN_INTERVAL_MS } }
  );
  logger.info("reminder scheduler started", { intervalMs: REMINDER_SCAN_INTERVAL_MS });
}

/**
 * Register the daily nudge scan job — fires at 4 PM IST (10:30 UTC) every day.
 * BullMQ deduplicates repeatable jobs by key — safe to call on every worker restart.
 */
export async function startNudgeScheduler(
  queue: Queue<ScanRemindersPayload>
): Promise<void> {
  await queue.add(
    JOB_NAME_SCAN_NUDGES,
    {},
    { repeat: { pattern: "30 10 * * *" } } // 10:30 UTC = 4:00 PM IST
  );
  logger.info("nudge scheduler started", { schedule: "10:30 UTC (4 PM IST) daily" });
}

/**
 * Scan for due reminders, send check-in messages, and reschedule each one.
 * Errors for individual reminders are caught and logged without aborting the scan.
 */
export async function processReminderScan(): Promise<void> {
  const now = new Date();

  const dueReminders = await prisma.userReminder.findMany({
    where: {
      isActive: true,
      nextFireAt: { lte: now },
    },
    include: {
      user: {
        include: {
          identities: true,
          settings: true,
        },
      },
    },
  });

  if (dueReminders.length === 0) return;

  logger.info("reminder scan: found due reminders", { count: dueReminders.length });

  for (const reminder of dueReminders) {
    try {
      const whatsappIdentity = reminder.user.identities.find(
        (i) => i.channel === "whatsapp"
      );
      if (!whatsappIdentity) {
        logger.warn("reminder scan: no whatsapp identity for user", {
          userId: reminder.userId,
          reminderId: reminder.id,
        });
        continue;
      }

      const toDigits = whatsappIdentity.channelUserKey.replace(/^\+/, "");
      const message = pickCheckinMessage();

      await sendWhatsAppReply(toDigits, message);

      const timezone = reminder.user.settings?.timezone ?? "Asia/Kolkata";
      const nextFireAt = computeNextFireAt(reminder.time, timezone);

      await prisma.userReminder.update({
        where: { id: reminder.id },
        data: { nextFireAt },
      });

      logger.info("reminder sent", {
        userId: reminder.userId,
        reminderId: reminder.id,
        nextFireAt,
      });
    } catch (err) {
      logger.error("reminder scan: failed to process reminder", {
        reminderId: reminder.id,
        userId: reminder.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

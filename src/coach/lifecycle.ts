import type { Queue } from "bullmq";
import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { JOB_NAME_SCAN_ENGAGEMENT_EXPIRY, type ScanRemindersPayload } from "../queues/reminderQueue";

// Coach-support engagement lifecycle: time-bound expiry (D9). Explicit end-by-either-
// side lives in the REST handlers; access is cut by derivation in both cases (D11/D23),
// so neither end path needs to touch InsightShare rows.

// Auto-close active engagements whose term has passed. endedBy='expiry' distinguishes
// these from party-initiated ends. Returns how many were closed.
export async function expireDueEngagements(): Promise<number> {
  const now = new Date();
  const res = await prisma.engagement.updateMany({
    where: { status: "active", endDate: { not: null, lte: now } },
    data: { status: "ended", endedAt: now, endedBy: "expiry" },
  });
  if (res.count > 0) logger.info("engagements expired", { count: res.count });
  return res.count;
}

// Register the daily expiry sweep on the shared reminder queue. BullMQ dedupes
// repeatable jobs by key — safe to call on every worker restart.
export async function startEngagementExpiryScheduler(queue: Queue<ScanRemindersPayload>): Promise<void> {
  await queue.add(
    JOB_NAME_SCAN_ENGAGEMENT_EXPIRY,
    {},
    { repeat: { pattern: "30 0 * * *" } } // 00:30 UTC daily
  );
  logger.info("engagement expiry scheduler started", { schedule: "00:30 UTC daily" });
}

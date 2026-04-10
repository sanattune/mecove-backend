import { prisma } from "../../infra/prisma";
import { logger } from "../../infra/logger";
import { sendWhatsAppReply } from "../../infra/whatsapp";
import { generateNudgeMessage } from "./nudgeReply";

const INACTIVITY_THRESHOLD_DAYS = 3;
const INACTIVITY_THRESHOLD_MS = INACTIVITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

/**
 * Scan for users who should receive an inactivity nudge and send them one.
 *
 * Eligibility:
 * - No active UserReminder (they have their own check-in already)
 * - Last message is older than 3 days
 * - Either never nudged, or their last message came AFTER lastNudgedAt
 *   (meaning they replied since the last nudge and have now gone quiet again)
 */
export async function processNudgeScan(): Promise<void> {
  const thresholdDate = new Date(Date.now() - INACTIVITY_THRESHOLD_MS);

  // Fetch candidates: approved users with no active reminder
  const candidates = await prisma.user.findMany({
    where: {
      approvedAt: { not: null },
      reminders: { none: { isActive: true } },
    },
    include: {
      settings: true,
      identities: { where: { channel: "whatsapp" } },
      messages: {
        where: { category: { notIn: ["test_feedback", "summary_request"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const eligible = candidates.filter((user) => {
    const lastMessage = user.messages[0];

    // No messages at all — nothing to nudge about
    if (!lastMessage) return false;

    // Last message must be older than threshold
    if (lastMessage.createdAt > thresholdDate) return false;

    // Must have a WhatsApp identity to send to
    if (user.identities.length === 0) return false;

    const lastNudgedAt = user.settings?.lastNudgedAt ?? null;

    // Never nudged — eligible
    if (!lastNudgedAt) return true;

    // Nudged before — only eligible if they replied after the last nudge
    // (i.e. last message is more recent than lastNudgedAt)
    return lastMessage.createdAt > lastNudgedAt;
  });

  if (eligible.length === 0) return;

  logger.info("nudge scan: found eligible users", { count: eligible.length });

  for (const user of eligible) {
    try {
      const identity = user.identities[0];
      const toDigits = identity.channelUserKey.replace(/^\+/, "");

      const message = await generateNudgeMessage(user.id);
      await sendWhatsAppReply(toDigits, message);

      await prisma.userSettings.upsert({
        where: { userId: user.id },
        update: { lastNudgedAt: new Date() },
        create: { userId: user.id, lastNudgedAt: new Date() },
      });

      logger.info("nudge sent", { userId: user.id });
    } catch (err) {
      logger.error("nudge scan: failed to nudge user", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

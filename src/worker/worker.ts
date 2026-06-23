import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { getRedis } from "../infra/redis";
import {
  INSIGHT_QUEUE_NAME,
  JOB_NAME_GENERATE_INSIGHT,
  type GenerateInsightPayload,
} from "../queues/insightQueue";
import {
  REPLY_QUEUE_NAME,
  JOB_NAME_GENERATE_REPLY,
  type GenerateReplyPayload,
} from "../queues/replyQueue";
import {
  JOB_NAME_FLUSH_REPLY_BATCH,
  REPLY_BATCH_QUEUE_NAME,
  replyBatchQueue,
  type FlushReplyBatchPayload,
} from "../queues/replyBatchQueue";
import { generateAckDecision } from "../llm/reply/ack/ackReply";
import { decryptText, encryptText, getKek } from "../infra/encryption";
import { getOrCreateUserDek } from "../infra/userDek";
import { handleCheckinIntent } from "../engagement/checkin/handler";
import {
  sendWhatsAppButtons,
  sendWhatsAppDocument,
  sendWhatsAppReply,
  sendWhatsAppTypingIndicator,
} from "../infra/whatsapp";
import { buildWindowBundle } from "../insight/windowBuilder";
import { buildMinimalFallbackReport } from "../insight/sessionbridge/assembler";
import { generateInsightPipeline } from "../insight/pipeline";
import { insightLockKey, insightTypePromptKey } from "../insight/keys";
import {
  REMINDER_QUEUE_NAME,
  JOB_NAME_SCAN_REMINDERS,
  JOB_NAME_SCAN_NUDGES,
  reminderQueue,
  type ScanRemindersPayload,
} from "../queues/reminderQueue";
import { startReminderScheduler, startNudgeScheduler, processReminderScan } from "../engagement/scheduler";
import { processNudgeScan } from "../engagement/nudge/nudgeHandler";
import {
  REPLY_BATCH_DEBOUNCE_MS,
  REPLY_BATCH_MAX_WAIT_MS,
  WHATSAPP_TYPING_INDICATOR_ENABLED,
} from "../replyBatch/config";
import {
  acquireReplyBatchFlushLock,
  claimBatchAtomically,
  clearReplyBatchState,
  getBatchTiming,
  releaseReplyBatchFlushLock,
  restoreClaimedBatch,
  type ClaimedReplyBatch,
} from "../replyBatch/state";
import { handleCommand } from "../commands/handler";

// Fail fast on startup
if (!process.env.REDIS_URL?.trim()) {
  throw new Error("REDIS_URL is required. Set it in .env");
}
getKek(); // validates ENCRYPTION_MASTER_KEY at startup
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());
const hasDatabaseParts = Boolean(
  process.env.DB_HOST?.trim() &&
    process.env.DB_NAME?.trim() &&
    process.env.DB_USER?.trim() &&
    process.env.DB_PASSWORD?.trim()
);
if (!hasDatabaseUrl && !hasDatabaseParts) {
  throw new Error(
    "DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD) is required. Set it in the environment."
  );
}

const INSIGHT_LOCK_TTL_SECONDS = 15 * 60;
const INSIGHT_ALREADY_RUNNING_TEXT =
  "Your previous insight is still being generated. Please wait.";
const INSIGHT_TIMEOUT_TEXT = "Insight generation timed out. Please request again.";
const BUSY_NOTICE_TEXT =
  "Please wait, I am processing your previous message. Retry command in a moment.";

const INSIGHT_PROMPT_TTL_SECONDS = 10 * 60;
const INSIGHT_TYPE_PROMPT_TEXT =
  "Looks like you'd like a report. Pick the kind. \"SessionBridge\" is a neutral brief of what you logged \u2014 good to share with a therapist or coach. \"Myself, lately\" is your own words mirrored back, grouped by theme. If you didn't mean to ask, just keep chatting \u2014 no report will be generated unless you press a button.";
const INSIGHT_TYPE_BUTTONS: Array<{ id: string; title: string }> = [
  { id: "insight_type_sessionbridge", title: "SessionBridge" },
  { id: "insight_type_myself_lately", title: "Myself, lately" },
];

type BatchDueReason = "quiet" | "max_cap";

async function sendInsightTypePrompts(channelUserKey: string): Promise<void> {
  await sendWhatsAppButtons(channelUserKey, INSIGHT_TYPE_PROMPT_TEXT, INSIGHT_TYPE_BUTTONS);
}

function parseCommand(messageText: string): string | null {
  const trimmed = messageText.trim();
  if (!trimmed.startsWith("/")) return null;
  return trimmed.split(/\s+/)[0].toLowerCase();
}


function evaluateBatchDue(nowMs: number, startAtMs: number, lastAtMs: number): {
  dueReason: BatchDueReason | null;
  delayMs: number;
} {
  const quietElapsed = nowMs - lastAtMs;
  const totalElapsed = nowMs - startAtMs;

  if (totalElapsed >= REPLY_BATCH_MAX_WAIT_MS) {
    return { dueReason: "max_cap", delayMs: 0 };
  }
  if (quietElapsed >= REPLY_BATCH_DEBOUNCE_MS) {
    return { dueReason: "quiet", delayMs: 0 };
  }

  const quietRemaining = REPLY_BATCH_DEBOUNCE_MS - quietElapsed;
  const capRemaining = REPLY_BATCH_MAX_WAIT_MS - totalElapsed;
  return {
    dueReason: null,
    delayMs: Math.max(1, Math.min(quietRemaining, capRemaining)),
  };
}

async function enqueueBatchFlush(userId: string, seq: number, delayMs: number): Promise<void> {
  await replyBatchQueue.add(
    JOB_NAME_FLUSH_REPLY_BATCH,
    { userId, seq },
    { delay: Math.max(1, Math.floor(delayMs)) }
  );
}

async function handleInsightIntent(input: {
  userId: string;
  channelUserKey: string;
}): Promise<{ kind: "text"; replyText: string } | { kind: "buttons"; replyText: string }> {
  const redis = getRedis();

  const lockKey = insightLockKey(input.userId);
  const inflight = await redis.get(lockKey);
  if (inflight) {
    return { kind: "text", replyText: INSIGHT_ALREADY_RUNNING_TEXT };
  }

  await redis.set(insightTypePromptKey(input.userId), "0", "EX", INSIGHT_PROMPT_TTL_SECONDS);
  await sendInsightTypePrompts(input.channelUserKey);
  return { kind: "buttons", replyText: INSIGHT_TYPE_PROMPT_TEXT };
}

// Insight worker
const insightWorker = new Worker<GenerateInsightPayload>(
  INSIGHT_QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME_GENERATE_INSIGHT) return;
    const { userId, channelUserKey, range, insightType, channel = "whatsapp", insightId: preCreatedInsightId } = job.data;

    const windowDays =
      range === "last_7_days"
        ? 7
        : range === "last_30_days"
          ? 30
          : range === "last_15_days"
            ? 15
            : null;
    if (!windowDays) return;

    const redis = getRedis();
    const lockKey = insightLockKey(userId);
    let insightId: string | null = preCreatedInsightId ?? null;
    let windowBundle: Awaited<ReturnType<typeof buildWindowBundle>> | null = null;

    try {
      windowBundle = await buildWindowBundle(userId, "Asia/Kolkata", new Date(), windowDays);

      if (insightId) {
        await prisma.insight.update({
          where: { id: insightId },
          data: {
            rangeStart: new Date(windowBundle.rangeStartUtc),
            rangeEnd: new Date(windowBundle.rangeEndUtc),
            status: "processing",
            inputMessagesCount: windowBundle.counts.totalMessages,
            inputHash: windowBundle.inputHash,
          },
        });
      } else {
        const insight = await prisma.insight.create({
          data: {
            userId,
            rangeStart: new Date(windowBundle.rangeStartUtc),
            rangeEnd: new Date(windowBundle.rangeEndUtc),
            status: "processing",
            inputMessagesCount: windowBundle.counts.totalMessages,
            inputHash: windowBundle.inputHash,
            insightType,
            channel,
          },
        });
        insightId = insight.id;
      }

      const result = await generateInsightPipeline({
        userId,
        insightId,
        timezone: "Asia/Kolkata",
        windowBundle,
        insightType,
      });

      if (channel === "whatsapp") {
        const filenamePrefix =
          insightType === "myself_lately" ? "myself-lately" : "sessionbridge";
        const filename = `${filenamePrefix}-${windowBundle.window.endDate}.pdf`;
        const caption =
          insightType === "myself_lately"
            ? "Your last days, mirrored back."
            : "Your summary is ready.";
        await sendWhatsAppDocument(channelUserKey, result.pdfBytes, filename, caption);
      }

      await prisma.insight.update({
        where: { id: insightId },
        data: {
          status: "success",
          insightText: result.finalReportText,
          modelName: result.modelName,
          promptVersion: result.promptVersionString,
          inputMessagesCount: windowBundle.counts.totalMessages,
          inputHash: windowBundle.inputHash,
          error: null,
          ...(channel === "app" && { pdfBytes: result.pdfBytes as unknown as Uint8Array<ArrayBuffer> }),
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("insight generation failed", {
        userId,
        insightId,
        error: reason,
      });

      let fallbackSent = false;
      try {
        if (!windowBundle) {
          windowBundle = await buildWindowBundle(userId, "Asia/Kolkata", new Date(), windowDays);
        }
        const fallback = await buildMinimalFallbackReport(windowBundle);

        if (channel === "whatsapp") {
          const fallbackFilename = `sessionbridge-${windowBundle.window.endDate}.pdf`;
          await sendWhatsAppDocument(
            channelUserKey,
            fallback.pdfBytes,
            fallbackFilename,
            "Your summary is ready."
          );
        }

        if (insightId) {
          await prisma.insight.update({
            where: { id: insightId },
            data: {
              status: "success_fallback",
              insightText: fallback.reportText,
              modelName: null,
              promptVersion: "fallback_v1",
              inputMessagesCount: windowBundle.counts.totalMessages,
              inputHash: windowBundle.inputHash,
              error: `Fallback used: ${reason}`,
              ...(channel === "app" && { pdfBytes: fallback.pdfBytes as unknown as Uint8Array<ArrayBuffer> }),
            },
          });
        } else {
          await prisma.insight.create({
            data: {
              userId,
              rangeStart: new Date(windowBundle.rangeStartUtc),
              rangeEnd: new Date(windowBundle.rangeEndUtc),
              status: "success_fallback",
              insightText: fallback.reportText,
              promptVersion: "fallback_v1",
              inputMessagesCount: windowBundle.counts.totalMessages,
              inputHash: windowBundle.inputHash,
              error: `Fallback used: ${reason}`,
              channel,
            },
          });
        }
        fallbackSent = true;
      } catch (fallbackErr) {
        logger.error("fallback insight generation failed", {
          userId,
          insightId,
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        });
      }

      if (!fallbackSent) {
        if (insightId) {
          await prisma.insight.update({
            where: { id: insightId },
            data: { status: "failed", error: reason },
          });
        } else if (windowBundle) {
          await prisma.insight.create({
            data: {
              userId,
              rangeStart: new Date(windowBundle.rangeStartUtc),
              rangeEnd: new Date(windowBundle.rangeEndUtc),
              status: "failed",
              inputMessagesCount: windowBundle.counts.totalMessages,
              inputHash: windowBundle.inputHash,
              error: reason,
              channel,
            },
          });
        } else {
          const now = new Date();
          const rangeStart = new Date(now);
          rangeStart.setDate(rangeStart.getDate() - 15);
          await prisma.insight.create({
            data: { userId, rangeStart, rangeEnd: now, status: "failed", error: reason, channel },
          });
        }
        throw err;
      }
    } finally {
      await redis.del(lockKey);
    }
  },
  { connection: getRedis() }
);

// Command and busy-notice worker
const replyWorker = new Worker<GenerateReplyPayload>(
  REPLY_QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME_GENERATE_REPLY) {
      logger.warn("reply job ignored: wrong job name", { jobName: job.name });
      return;
    }

    const { userId, messageId, channelUserKey, messageText, mode } = job.data;

    if (mode === "busy_notice") {
      await sendWhatsAppReply(channelUserKey, BUSY_NOTICE_TEXT);
      const busyDek = await getOrCreateUserDek(userId);
      await prisma.message.update({
        where: { id: messageId },
        data: {
          repliedAt: new Date(),
          replyText: encryptText(BUSY_NOTICE_TEXT, busyDek),
        },
      });
      return;
    }

    const command = parseCommand(messageText);
    if (!command) {
      logger.warn("reply command job ignored: missing slash command", { messageId, userId });
      return;
    }

    const sender = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const isAdminUser = sender?.role === "admin";

    const result = await handleCommand({ userId, messageId, channelUserKey, messageText, isAdminUser, command });

    if (result.kind === "handled") return;

    await sendWhatsAppReply(channelUserKey, result.text);

    if (result.kind === "reply") {
      const cmdDek = await getOrCreateUserDek(userId);
      await prisma.message.update({
        where: { id: messageId },
        data: {
          repliedAt: new Date(),
          replyText: encryptText(result.text, cmdDek),
        },
      });
    }
  },
  {
    connection: getRedis(),
    concurrency: 5,
  }
);

// Debounced batch flush worker
const replyBatchWorker = new Worker<FlushReplyBatchPayload>(
  REPLY_BATCH_QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME_FLUSH_REPLY_BATCH) {
      logger.warn("reply batch job ignored: wrong job name", { jobName: job.name });
      return;
    }

    const { userId, seq: jobSeq } = job.data;
    const timing = await getBatchTiming(userId);
    if (!timing) return;

    const nowMs = Date.now();
    const due = evaluateBatchDue(nowMs, timing.startAtMs, timing.lastAtMs);
    if (!due.dueReason) {
      await enqueueBatchFlush(userId, timing.seq, due.delayMs);
      return;
    }

    const lockToken = await acquireReplyBatchFlushLock(userId);
    if (!lockToken) {
      return;
    }

    const lockedTiming = await getBatchTiming(userId);
    if (!lockedTiming) {
      await releaseReplyBatchFlushLock(userId, lockToken);
      return;
    }
    const lockedDue = evaluateBatchDue(Date.now(), lockedTiming.startAtMs, lockedTiming.lastAtMs);
    if (!lockedDue.dueReason) {
      await enqueueBatchFlush(userId, lockedTiming.seq, lockedDue.delayMs);
      await releaseReplyBatchFlushLock(userId, lockToken);
      return;
    }

    let claimedBatch: ClaimedReplyBatch | null = null;
    let replySent = false;
    try {
      claimedBatch = await claimBatchAtomically(userId);
      if (!claimedBatch) return;

      const messages = await prisma.message.findMany({
        where: {
          userId,
          id: { in: claimedBatch.ids },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          text: true,
        },
      });
      if (messages.length === 0) return;

      const batchDek = await getOrCreateUserDek(userId);
      for (const m of messages) {
        if (m.text) m.text = decryptText(m.text, batchDek);
      }

      const combinedText = messages
        .map((m) => (m.text ?? "").trim())
        .filter((text) => text.length > 0 && !text.startsWith("/"))
        .join("\n");
      if (combinedText.length === 0) return;

      if (WHATSAPP_TYPING_INDICATOR_ENABLED) {
        try {
          await sendWhatsAppTypingIndicator(
            claimedBatch.meta.channelUserKey,
            claimedBatch.meta.latestSourceMessageId
          );
        } catch (err) {
          logger.warn("typing indicator call failed; continuing without indicator", {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const batchUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const isAdminBatchUser = batchUser?.role === "admin";

      let replyText = "Got it.";
      let shouldGenerateInsight = false;
      let shouldSetupCheckin = false;
      let decisionClassifierType: string | undefined;
      try {
        const decision = await generateAckDecision(userId, combinedText, "saved", { isAdmin: isAdminBatchUser });
        if (decision.replyText.trim().length > 0) {
          replyText = decision.replyText.trim();
        }
        shouldGenerateInsight = decision.shouldGenerateInsight;
        shouldSetupCheckin = decision.shouldSetupCheckin ?? false;
        decisionClassifierType = decision.classifierType;
        logger.info("ack decision insight flag", {
          userId,
          shouldGenerateInsight,
          shouldSetupCheckin,
          batchMessageCount: combinedText ? combinedText.split(/\n/).length : 0,
        });
      } catch (err) {
        logger.warn("LLM batch reply generation failed, using fallback", err);
      }

      if (shouldSetupCheckin) {
        const checkinBodyText = await handleCheckinIntent({
          userId,
          channelUserKey: claimedBatch.meta.channelUserKey,
        });
        replyText = checkinBodyText;
        replySent = true;
        // Tag all batch messages as command_reply so they're filtered from future LLM context
        await prisma.message.updateMany({
          where: { id: { in: claimedBatch.ids } },
          data: { category: "command_reply" },
        });
      } else if (shouldGenerateInsight) {
        // Label the latest message in the batch as a summary request so it is
        // excluded from future report windows.
        const latestBatchMsgId = messages[messages.length - 1]?.id;
        if (latestBatchMsgId) {
          await prisma.message.update({
            where: { id: latestBatchMsgId },
            data: { category: "summary_request" },
          });
        }

        const result = await handleInsightIntent({
          userId,
          channelUserKey: claimedBatch.meta.channelUserKey,
        });
        replyText = result.replyText;
        if (result.kind === "text") {
          await sendWhatsAppReply(claimedBatch.meta.channelUserKey, replyText);
        }
        replySent = true;
      } else {
        await sendWhatsAppReply(claimedBatch.meta.channelUserKey, replyText);
        replySent = true;
      }

      const latestMessageId = messages.some((m) => m.id === claimedBatch?.meta.latestMessageId)
        ? claimedBatch.meta.latestMessageId
        : messages[messages.length - 1]?.id;

      if (latestMessageId) {
        try {
          await prisma.message.update({
            where: { id: latestMessageId },
            data: {
              repliedAt: new Date(),
              replyText: encryptText(replyText, batchDek),
              ...(decisionClassifierType ? { classifierType: decisionClassifierType } : {}),
            },
          });
        } catch (err) {
          logger.error("failed to persist latest batch message reply metadata", {
            userId,
            latestMessageId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info("reply batch flushed", {
        userId,
        batchCount: claimedBatch.ids.length,
        dueReason: lockedDue.dueReason,
        waitMs: nowMs - claimedBatch.meta.startAtMs,
        jobSeq,
        currentSeq: lockedTiming.seq,
      });
    } catch (err) {
      if (claimedBatch && !replySent) {
        try {
          await restoreClaimedBatch(userId, claimedBatch);
          await enqueueBatchFlush(userId, claimedBatch.meta.seq, REPLY_BATCH_DEBOUNCE_MS);
        } catch (restoreErr) {
          logger.error("failed to restore claimed batch after processing error", {
            userId,
            error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
          });
        }
      }
      throw err;
    } finally {
      await releaseReplyBatchFlushLock(userId, lockToken);
    }
  },
  {
    connection: getRedis(),
    concurrency: 5,
  }
);

// Reminder + nudge scan worker
const reminderWorker = new Worker<ScanRemindersPayload>(
  REMINDER_QUEUE_NAME,
  async (job) => {
    if (job.name === JOB_NAME_SCAN_REMINDERS) {
      await processReminderScan();
    } else if (job.name === JOB_NAME_SCAN_NUDGES) {
      await processNudgeScan();
    }
  },
  {
    connection: getRedis(),
    concurrency: 1,
  }
);

reminderWorker.on("failed", (job, err) => {
  logger.error("reminder job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

replyWorker.on("failed", (job, err) => {
  logger.error("reply job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

replyBatchWorker.on("failed", (job, err) => {
  logger.error("reply batch job failed", {
    jobId: job?.id,
    error: err.message,
    userId: job?.data?.userId,
  });
});

insightWorker.on("failed", (job, err) => {
  const userId = job?.data?.userId;
  const channelUserKey = job?.data?.channelUserKey;
  if (userId) {
    void getRedis().del(insightLockKey(userId));
  }
  if (channelUserKey && /timed out/i.test(err.message)) {
    void sendWhatsAppReply(channelUserKey, INSIGHT_TIMEOUT_TEXT).catch((sendErr) => {
      logger.error("failed to send insight timeout notification", {
        jobId: job?.id,
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    });
  }
  logger.error("insight job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

async function shutdown() {
  await Promise.all([
    insightWorker.close(),
    replyWorker.close(),
    replyBatchWorker.close(),
    reminderWorker.close(),
  ]);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

void startReminderScheduler(reminderQueue);
void startNudgeScheduler(reminderQueue);

logger.info("worker started (insight + reply + reply_batch + reminder queues)");

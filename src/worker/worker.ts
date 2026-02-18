import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { getRedis } from "../infra/redis";
import {
  summaryQueue,
  SUMMARY_QUEUE_NAME,
  JOB_NAME_GENERATE_SUMMARY,
  type GenerateSummaryPayload,
} from "../queues/summaryQueue";
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
import { generateAckDecision } from "../llm/ackReply";
import {
  TEST_FEEDBACK_COMMAND,
  TEST_FEEDBACK_SUCCESS_REPLY,
} from "../messages/testFeedback";
import {
  sendWhatsAppBufferDocument,
  sendWhatsAppDocument,
  sendWhatsAppReply,
  sendWhatsAppTypingIndicator,
} from "../infra/whatsapp";
import { buildWindowBundle } from "../summary/p0";
import { buildMinimalFallbackReport } from "../summary/p1";
import { generateSummaryPipeline } from "../summary/pipeline";
import { clearSummaryArtifactsForUser } from "../summary/redisArtifacts";
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

// Fail fast on startup
if (!process.env.REDIS_URL?.trim()) {
  throw new Error("REDIS_URL is required. Set it in .env");
}
if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required. Set it in .env");
}

const SUMMARY_LOCK_TTL_SECONDS = 15 * 60;
const SUMMARY_REQUEST_ACCEPTED_TEXT =
  "I will generate a summary for past 15 days activity and send it to you in a bit. Please wait.";
const SUMMARY_ALREADY_RUNNING_TEXT =
  "Your previous summary is still being generated. Please wait.";
const SUMMARY_TIMEOUT_TEXT = "Summary generation timed out. Please request again.";
const CHATLOG_SENT_TEXT = "I have sent your chat log as an attachment.";
const CHAT_CLEARED_TEXT = "Your chat history has been cleared.";
const UNKNOWN_COMMAND_TEXT = "Unknown command. Available: /chatlog, /clear, /f";
const BUSY_NOTICE_TEXT =
  "Please wait, I am processing your previous message. Retry command in a moment.";

type BatchDueReason = "quiet" | "max_cap";

function summaryLockKey(userId: string): string {
  return `summary:inflight:${userId}`;
}

function parseCommand(messageText: string): string | null {
  const trimmed = messageText.trim();
  if (!trimmed.startsWith("/")) return null;
  return trimmed.split(/\s+/)[0].toLowerCase();
}

async function buildAllTimeChatlogMarkdown(userId: string): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, text: true, replyText: true, repliedAt: true },
  });

  const formatTime = (d: Date): string =>
    d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

  const lines: string[] = [];
  lines.push("# MeCove Chat Log");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  let currentDateHeader = "";
  let hasAnyMessage = false;

  for (const m of messages) {
    const userText = (m.text ?? "").trim();
    if (!userText) continue;
    if (userText.startsWith("/")) continue;

    hasAnyMessage = true;
    const dateHeader = m.createdAt.toISOString().slice(0, 10);
    if (dateHeader !== currentDateHeader) {
      currentDateHeader = dateHeader;
      lines.push(`## ${dateHeader}`);
      lines.push("");
    }

    lines.push(`User(${formatTime(m.createdAt)}): ${userText}`);
    if (m.replyText && m.repliedAt) {
      lines.push(`Bot(${formatTime(m.repliedAt)}): ${m.replyText.trim()}`);
    }
    lines.push("");
  }

  if (!hasAnyMessage) {
    lines.push("_No chat messages available._");
    lines.push("");
  }

  return lines.join("\n");
}

function evaluateBatchDue(
  nowMs: number,
  startAtMs: number,
  lastAtMs: number,
  batchSize: number
): {
  dueReason: BatchDueReason | null;
  delayMs: number;
} {
  const quietElapsed = nowMs - lastAtMs;
  const totalElapsed = nowMs - startAtMs;

  if (batchSize >= 3) {
    return { dueReason: "max_cap", delayMs: 0 };
  }
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

async function applySummaryIntent(
  userId: string,
  messageId: string,
  channelUserKey: string,
  shouldGenerateSummary: boolean,
  defaultReplyText: string
): Promise<string> {
  if (!shouldGenerateSummary) return defaultReplyText;

  const redis = getRedis();
  const lockKey = summaryLockKey(userId);
  const lockValue = JSON.stringify({ messageId, createdAt: new Date().toISOString() });
  const acquired = await redis.set(lockKey, lockValue, "EX", SUMMARY_LOCK_TTL_SECONDS, "NX");
  if (!acquired) {
    return SUMMARY_ALREADY_RUNNING_TEXT;
  }

  try {
    await summaryQueue.add(JOB_NAME_GENERATE_SUMMARY, {
      userId,
      channelUserKey,
      range: "last_15_days",
    });
    logger.info("summary generation requested by user intent", {
      userId,
      messageId,
    });
    return SUMMARY_REQUEST_ACCEPTED_TEXT;
  } catch (err) {
    await redis.del(lockKey);
    logger.error("failed to enqueue summary generation", {
      userId,
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    return defaultReplyText;
  }
}

// Summary worker
const summaryWorker = new Worker<GenerateSummaryPayload>(
  SUMMARY_QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME_GENERATE_SUMMARY) return;
    const { userId, channelUserKey, range } = job.data;
    if (range !== "last_15_days") return;

    const redis = getRedis();
    const lockKey = summaryLockKey(userId);
    let summaryId: string | null = null;
    let windowBundle: Awaited<ReturnType<typeof buildWindowBundle>> | null = null;

    try {
      windowBundle = await buildWindowBundle(userId, "Asia/Kolkata");
      const summary = await prisma.summary.create({
        data: {
          userId,
          rangeStart: new Date(windowBundle.rangeStartUtc),
          rangeEnd: new Date(windowBundle.rangeEndUtc),
          status: "processing",
          inputMessagesCount: windowBundle.counts.totalMessages,
          inputHash: windowBundle.inputHash,
        },
      });
      summaryId = summary.id;

      const result = await generateSummaryPipeline({
        userId,
        summaryId,
        timezone: "Asia/Kolkata",
        windowBundle,
      });

      const filename = `mecove-summary-${windowBundle.window.endDate}.pdf`;
      await sendWhatsAppDocument(channelUserKey, result.pdfBytes, filename, "Your summary is ready.");

      await prisma.summary.update({
        where: { id: summaryId },
        data: {
          status: "success",
          summaryText: result.finalReportText,
          modelName: result.modelName,
          promptVersion: result.promptVersionString,
          inputMessagesCount: windowBundle.counts.totalMessages,
          inputHash: windowBundle.inputHash,
          error: null,
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("summary generation failed", {
        userId,
        summaryId,
        error: reason,
      });

      let fallbackSent = false;
      try {
        if (!windowBundle) {
          windowBundle = await buildWindowBundle(userId, "Asia/Kolkata");
        }
        const fallback = buildMinimalFallbackReport(windowBundle);
        const fallbackFilename = `mecove-summary-${windowBundle.window.endDate}.pdf`;
        await sendWhatsAppDocument(
          channelUserKey,
          fallback.pdfBytes,
          fallbackFilename,
          "Your summary is ready."
        );
        if (summaryId) {
          await prisma.summary.update({
            where: { id: summaryId },
            data: {
              status: "success_fallback",
              summaryText: fallback.reportText,
              modelName: null,
              promptVersion: "fallback_v1",
              inputMessagesCount: windowBundle.counts.totalMessages,
              inputHash: windowBundle.inputHash,
              error: `Fallback used: ${reason}`,
            },
          });
        } else {
          await prisma.summary.create({
            data: {
              userId,
              rangeStart: new Date(windowBundle.rangeStartUtc),
              rangeEnd: new Date(windowBundle.rangeEndUtc),
              status: "success_fallback",
              summaryText: fallback.reportText,
              promptVersion: "fallback_v1",
              inputMessagesCount: windowBundle.counts.totalMessages,
              inputHash: windowBundle.inputHash,
              error: `Fallback used: ${reason}`,
            },
          });
        }
        fallbackSent = true;
      } catch (fallbackErr) {
        logger.error("fallback summary generation failed", {
          userId,
          summaryId,
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        });
      }

      if (!fallbackSent) {
        if (summaryId) {
          await prisma.summary.update({
            where: { id: summaryId },
            data: {
              status: "failed",
              error: reason,
            },
          });
        } else if (windowBundle) {
          await prisma.summary.create({
            data: {
              userId,
              rangeStart: new Date(windowBundle.rangeStartUtc),
              rangeEnd: new Date(windowBundle.rangeEndUtc),
              status: "failed",
              inputMessagesCount: windowBundle.counts.totalMessages,
              inputHash: windowBundle.inputHash,
              error: reason,
            },
          });
        } else {
          const now = new Date();
          const rangeStart = new Date(now);
          rangeStart.setDate(rangeStart.getDate() - 15);
          await prisma.summary.create({
            data: {
              userId,
              rangeStart,
              rangeEnd: now,
              status: "failed",
              error: reason,
            },
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
      await prisma.message.update({
        where: { id: messageId },
        data: {
          repliedAt: new Date(),
          replyText: BUSY_NOTICE_TEXT,
        },
      });
      return;
    }

    const command = parseCommand(messageText);
    if (!command) {
      logger.warn("reply command job ignored: missing slash command", { messageId, userId });
      return;
    }

    let replyText = CHATLOG_SENT_TEXT;

    if (command === "/chatlog") {
      const chatlog = await buildAllTimeChatlogMarkdown(userId);
      const filename = `mecove-chatlog-${new Date().toISOString().slice(0, 10)}.md`;
      await sendWhatsAppBufferDocument(
        channelUserKey,
        Buffer.from(chatlog, "utf8"),
        filename,
        "text/plain",
        "Your chat log is ready."
      );
    } else if (command === "/clear") {
      await prisma.$transaction([
        prisma.summary.deleteMany({ where: { userId } }),
        prisma.message.deleteMany({ where: { userId } }),
      ]);
      await getRedis().del(summaryLockKey(userId));
      await clearReplyBatchState(userId);
      await clearSummaryArtifactsForUser(userId);
      replyText = CHAT_CLEARED_TEXT;
    } else if (command === TEST_FEEDBACK_COMMAND) {
      replyText = TEST_FEEDBACK_SUCCESS_REPLY;
    } else {
      replyText = UNKNOWN_COMMAND_TEXT;
    }

    await sendWhatsAppReply(channelUserKey, replyText);

    if (command !== "/clear") {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          repliedAt: new Date(),
          replyText,
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
    const due = evaluateBatchDue(nowMs, timing.startAtMs, timing.lastAtMs, timing.count);
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
    const lockedDue = evaluateBatchDue(
      Date.now(),
      lockedTiming.startAtMs,
      lockedTiming.lastAtMs,
      lockedTiming.count
    );
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

      let replyText = "Got it.";
      let shouldGenerateSummary = false;
      try {
        const decision = await generateAckDecision(userId, combinedText);
        if (decision.replyText.trim().length > 0) {
          replyText = decision.replyText.trim();
        }
        shouldGenerateSummary = decision.shouldGenerateSummary;
      } catch (err) {
        logger.warn("LLM batch reply generation failed, using fallback", err);
      }

      replyText = await applySummaryIntent(
        userId,
        claimedBatch.meta.latestMessageId,
        claimedBatch.meta.channelUserKey,
        shouldGenerateSummary,
        replyText
      );

      await sendWhatsAppReply(claimedBatch.meta.channelUserKey, replyText);
      replySent = true;

      const latestMessageId = messages.some((m) => m.id === claimedBatch?.meta.latestMessageId)
        ? claimedBatch.meta.latestMessageId
        : messages[messages.length - 1]?.id;

      if (latestMessageId) {
        try {
          await prisma.message.update({
            where: { id: latestMessageId },
            data: {
              repliedAt: new Date(),
              replyText,
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

summaryWorker.on("failed", (job, err) => {
  const userId = job?.data?.userId;
  const channelUserKey = job?.data?.channelUserKey;
  if (userId) {
    void getRedis().del(summaryLockKey(userId));
  }
  if (channelUserKey && /timed out/i.test(err.message)) {
    void sendWhatsAppReply(channelUserKey, SUMMARY_TIMEOUT_TEXT).catch((sendErr) => {
      logger.error("failed to send summary timeout notification", {
        jobId: job?.id,
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    });
  }
  logger.error("summary job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

async function shutdown() {
  await Promise.all([summaryWorker.close(), replyWorker.close(), replyBatchWorker.close()]);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

logger.info("worker started (summary + reply + reply_batch queues)");

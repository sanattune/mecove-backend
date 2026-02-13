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
import { countMessagesAfter } from "../infra/messageTracking";
import { generateAckDecision } from "../llm/ackReply";
import {
  TEST_FEEDBACK_COMMAND,
  TEST_FEEDBACK_SUCCESS_REPLY,
} from "../messages/testFeedback";
import {
  sendWhatsAppBufferDocument,
  sendWhatsAppDocument,
  sendWhatsAppReply,
} from "../infra/whatsapp";
import { buildWindowBundle } from "../summary/p0";
import { buildMinimalFallbackReport } from "../summary/p1";
import { generateSummaryPipeline } from "../summary/pipeline";
import { clearSummaryArtifactsForUser } from "../summary/redisArtifacts";

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
    if (userText.startsWith("/")) continue; // Exclude slash-command entries from export

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

// Reply worker
const replyWorker = new Worker<GenerateReplyPayload>(
  REPLY_QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME_GENERATE_REPLY) {
      logger.warn("reply job ignored: wrong job name", { jobName: job.name });
      return;
    }
    const {
      userId,
      messageId,
      identityId,
      sourceMessageId,
      channelUserKey,
      messageText,
      messageTimestamp,
    } = job.data;
    const command = parseCommand(messageText);
    if (command) {
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
        await getRedis().del(`messages:${userId}`, summaryLockKey(userId));
        await clearSummaryArtifactsForUser(userId);
        replyText = CHAT_CLEARED_TEXT;
      } else if (command === TEST_FEEDBACK_COMMAND) {
        replyText = TEST_FEEDBACK_SUCCESS_REPLY;
      } else {
        replyText = UNKNOWN_COMMAND_TEXT;
      }

      const messagesAfterCount = await countMessagesAfter(userId, messageTimestamp);
      const shouldSendContextual = messagesAfterCount > 1 || Date.now() - messageTimestamp > 10_000;
      const contextualMessageId = shouldSendContextual ? sourceMessageId : undefined;
      await sendWhatsAppReply(channelUserKey, replyText, contextualMessageId);

      if (command !== "/clear") {
        await prisma.message.update({
          where: { id: messageId },
          data: {
            repliedAt: new Date(),
            replyText,
          },
        });
      }
      return;
    }

    // Generate reply using LLM
    let replyText = "Noted.";
    let shouldGenerateSummary = false;
    try {
      const decision = await generateAckDecision(userId, messageText);
      if (decision.replyText.trim().length > 0) {
        replyText = decision.replyText.trim();
      }
      shouldGenerateSummary = decision.shouldGenerateSummary;
    } catch (err) {
      logger.warn("LLM reply generation failed, using fallback", err);
    }

    if (shouldGenerateSummary) {
      const redis = getRedis();
      const lockKey = summaryLockKey(userId);
      const lockValue = JSON.stringify({ messageId, createdAt: new Date().toISOString() });
      const acquired = await redis.set(lockKey, lockValue, "EX", SUMMARY_LOCK_TTL_SECONDS, "NX");
      if (acquired) {
        replyText = SUMMARY_REQUEST_ACCEPTED_TEXT;
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
        } catch (err) {
          await redis.del(lockKey);
          logger.error("failed to enqueue summary generation", {
            userId,
            messageId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        replyText = SUMMARY_ALREADY_RUNNING_TEXT;
      }
    }

    // Check how many messages came after this message
    const messagesAfterCount = await countMessagesAfter(userId, messageTimestamp);
    
    // Check time elapsed since message was received
    const currentTime = Date.now();
    const timeSinceMessage = currentTime - messageTimestamp;
    const STALE_THRESHOLD_MS = 10000; // 10 seconds
    
    // Send contextual reply if:
    // 1. There are more than 1 message after (threshold: > 1), OR
    // 2. The response is being sent more than 10 seconds after the message was received
    const shouldSendContextual = messagesAfterCount > 1 || timeSinceMessage > STALE_THRESHOLD_MS;

    // Essential log: reply decision and context
    logger.info("reply decision", {
      messageId,
      contextual: shouldSendContextual,
      messagesAfter: messagesAfterCount,
      timeSinceMessageMs: timeSinceMessage,
      isStale: timeSinceMessage > STALE_THRESHOLD_MS,
      threshold: 1,
    });

    // Send reply (contextual if there are more than 1 message after this one)
    const contextualMessageId = shouldSendContextual ? sourceMessageId : undefined;
    if (shouldSendContextual) {
      logger.info("sending as contextual reply", { messageId, sourceMessageId, messagesAfter: messagesAfterCount });
    }
    try {
      await sendWhatsAppReply(channelUserKey, replyText, contextualMessageId);
    } catch (err) {
      logger.error("failed to send WhatsApp reply", err);
      throw err; // Re-throw to trigger retry
    }

    // Update database: mark as replied and store reply text
    await prisma.message.update({
      where: { id: messageId },
      data: {
        repliedAt: new Date(),
        replyText,
      },
    });

    // Essential log: reply decision and context
    logger.info("reply sent", {
      messageId,
      contextual: shouldSendContextual,
      messagesAfter: messagesAfterCount,
    });
  },
  {
    connection: getRedis(),
    concurrency: 5,
  }
);

// Add error handlers
replyWorker.on("failed", (job, err) => {
  logger.error("reply job failed", {
    jobId: job?.id,
    error: err.message,
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
  await Promise.all([summaryWorker.close(), replyWorker.close()]);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

logger.info("worker started (summary + reply queues)");

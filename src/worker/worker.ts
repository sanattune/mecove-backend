import "dotenv/config";
import { createHash } from "node:crypto";
import type { Message } from "@prisma/client";
import { Worker } from "bullmq";
import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { getRedis } from "../infra/redis";
import {
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
import { generateAckReply } from "../llm/ackReply";
import { sendWhatsAppReply } from "../infra/whatsapp";

// Fail fast on startup
if (!process.env.REDIS_URL?.trim()) {
  throw new Error("REDIS_URL is required. Set it in .env");
}
if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required. Set it in .env");
}

function simpleInputHash(messageIds: string[], texts: (string | null)[]): string {
  const parts = messageIds.concat(texts.map((t) => t ?? ""));
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

// Summary worker
const summaryWorker = new Worker<GenerateSummaryPayload>(
  SUMMARY_QUEUE_NAME,
  async (job) => {
    if (job.name !== JOB_NAME_GENERATE_SUMMARY) return;
    const { userId, range } = job.data;
    if (range !== "last_7_days") return;

    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - 7);

    const messages = await prisma.message.findMany({
      where: {
        userId,
        createdAt: { gte: rangeStart, lte: now },
      },
      orderBy: { createdAt: "asc" },
    });

    const N = messages.length;
    const messageIds = messages.map((m: Message) => m.id);
    const texts = messages.map((m: Message) => m.text);
    const inputHash = simpleInputHash(messageIds, texts);

    await prisma.summary.create({
      data: {
        userId,
        rangeStart,
        rangeEnd: now,
        status: "success",
        summaryText: `Summary generated for ${N} messages.`,
        inputMessagesCount: N,
        inputHash,
      },
    });

    // Silent - no log needed for normal operation
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

    // Generate reply using LLM
    let replyText = "Noted.";
    try {
      const ack = await generateAckReply(userId, messageText);
      if (ack.trim().length > 0) replyText = ack.trim();
    } catch (err) {
      logger.warn("LLM reply generation failed, using fallback", err);
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
    logger.info("reply sent", {
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

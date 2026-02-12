"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_crypto_1 = require("node:crypto");
const bullmq_1 = require("bullmq");
const prisma_1 = require("../infra/prisma");
const logger_1 = require("../infra/logger");
const redis_1 = require("../infra/redis");
const summaryQueue_1 = require("../queues/summaryQueue");
const replyQueue_1 = require("../queues/replyQueue");
const messageTracking_1 = require("../infra/messageTracking");
const ackReply_1 = require("../llm/ackReply");
const whatsapp_1 = require("../infra/whatsapp");
// Fail fast on startup
if (!process.env.REDIS_URL?.trim()) {
    throw new Error("REDIS_URL is required. Set it in .env");
}
if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required. Set it in .env");
}
function simpleInputHash(messageIds, texts) {
    const parts = messageIds.concat(texts.map((t) => t ?? ""));
    return (0, node_crypto_1.createHash)("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
// Summary worker
const summaryWorker = new bullmq_1.Worker(summaryQueue_1.SUMMARY_QUEUE_NAME, async (job) => {
    if (job.name !== summaryQueue_1.JOB_NAME_GENERATE_SUMMARY)
        return;
    const { userId, range } = job.data;
    if (range !== "last_7_days")
        return;
    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - 7);
    const messages = await prisma_1.prisma.message.findMany({
        where: {
            userId,
            createdAt: { gte: rangeStart, lte: now },
        },
        orderBy: { createdAt: "asc" },
    });
    const N = messages.length;
    const messageIds = messages.map((m) => m.id);
    const texts = messages.map((m) => m.text);
    const inputHash = simpleInputHash(messageIds, texts);
    await prisma_1.prisma.summary.create({
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
}, { connection: (0, redis_1.getRedis)() });
// Reply worker
const replyWorker = new bullmq_1.Worker(replyQueue_1.REPLY_QUEUE_NAME, async (job) => {
    if (job.name !== replyQueue_1.JOB_NAME_GENERATE_REPLY) {
        logger_1.logger.warn("reply job ignored: wrong job name", { jobName: job.name });
        return;
    }
    const { userId, messageId, identityId, sourceMessageId, channelUserKey, messageText, messageTimestamp, } = job.data;
    // Generate reply using LLM
    let replyText = "Noted.";
    let shouldGenerateReport = false;
    try {
        const decision = await (0, ackReply_1.generateAckDecision)(userId, messageText);
        if (decision.replyText.trim().length > 0) {
            replyText = decision.replyText.trim();
        }
        shouldGenerateReport = decision.shouldGenerateReport;
    }
    catch (err) {
        logger_1.logger.warn("LLM reply generation failed, using fallback", err);
    }
    if (shouldGenerateReport) {
        try {
            await summaryQueue_1.summaryQueue.add(summaryQueue_1.JOB_NAME_GENERATE_SUMMARY, {
                userId,
                range: "last_7_days",
            });
            logger_1.logger.info("summary generation requested by user intent", {
                userId,
                messageId,
            });
        }
        catch (err) {
            logger_1.logger.error("failed to enqueue summary generation", {
                userId,
                messageId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    // Check how many messages came after this message
    const messagesAfterCount = await (0, messageTracking_1.countMessagesAfter)(userId, messageTimestamp);
    // Check time elapsed since message was received
    const currentTime = Date.now();
    const timeSinceMessage = currentTime - messageTimestamp;
    const STALE_THRESHOLD_MS = 10000; // 10 seconds
    // Send contextual reply if:
    // 1. There are more than 1 message after (threshold: > 1), OR
    // 2. The response is being sent more than 10 seconds after the message was received
    const shouldSendContextual = messagesAfterCount > 1 || timeSinceMessage > STALE_THRESHOLD_MS;
    // Essential log: reply decision and context
    logger_1.logger.info("reply decision", {
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
        logger_1.logger.info("sending as contextual reply", { messageId, sourceMessageId, messagesAfter: messagesAfterCount });
    }
    try {
        await (0, whatsapp_1.sendWhatsAppReply)(channelUserKey, replyText, contextualMessageId);
    }
    catch (err) {
        logger_1.logger.error("failed to send WhatsApp reply", err);
        throw err; // Re-throw to trigger retry
    }
    // Update database: mark as replied and store reply text
    await prisma_1.prisma.message.update({
        where: { id: messageId },
        data: {
            repliedAt: new Date(),
            replyText,
        },
    });
    // Essential log: reply decision and context
    logger_1.logger.info("reply sent", {
        messageId,
        contextual: shouldSendContextual,
        messagesAfter: messagesAfterCount,
    });
}, {
    connection: (0, redis_1.getRedis)(),
    concurrency: 5,
});
// Add error handlers
replyWorker.on("failed", (job, err) => {
    logger_1.logger.error("reply job failed", {
        jobId: job?.id,
        error: err.message,
    });
});
summaryWorker.on("failed", (job, err) => {
    logger_1.logger.error("summary job failed", {
        jobId: job?.id,
        error: err.message,
    });
});
async function shutdown() {
    await Promise.all([summaryWorker.close(), replyWorker.close()]);
    await prisma_1.prisma.$disconnect();
    process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
logger_1.logger.info("worker started (summary + reply queues)");

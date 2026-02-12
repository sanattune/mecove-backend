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
const pdf_1 = require("../infra/pdf");
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
const SUMMARY_LOCK_TTL_SECONDS = 15 * 60;
const SUMMARY_REQUEST_ACCEPTED_TEXT = "I will generate a summary for past 15 days activity and send it to you in a bit. Please wait.";
const SUMMARY_ALREADY_RUNNING_TEXT = "Your previous summary is still being generated. Please wait.";
const SUMMARY_TIMEOUT_TEXT = "Summary generation timed out. Please request again.";
const CHATLOG_SENT_TEXT = "I have sent your chat log as an attachment.";
const CHAT_CLEARED_TEXT = "Your chat history has been cleared.";
const UNKNOWN_COMMAND_TEXT = "Unknown command. Available: /chatlog, /clear";
function summaryLockKey(userId) {
    return `summary:inflight:${userId}`;
}
function parseCommand(messageText) {
    const trimmed = messageText.trim();
    if (!trimmed.startsWith("/"))
        return null;
    return trimmed.split(/\s+/)[0].toLowerCase();
}
async function buildAllTimeChatlogMarkdown(userId) {
    const messages = await prisma_1.prisma.message.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, text: true, replyText: true, repliedAt: true },
    });
    const formatTime = (d) => d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });
    const lines = [];
    lines.push("# MeCove Chat Log");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    let currentDateHeader = "";
    let hasAnyMessage = false;
    for (const m of messages) {
        const userText = (m.text ?? "").trim();
        if (!userText)
            continue;
        if (userText.startsWith("/"))
            continue; // Exclude slash-command entries from export
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
const summaryWorker = new bullmq_1.Worker(summaryQueue_1.SUMMARY_QUEUE_NAME, async (job) => {
    if (job.name !== summaryQueue_1.JOB_NAME_GENERATE_SUMMARY)
        return;
    const { userId, channelUserKey, range } = job.data;
    if (range !== "last_15_days")
        return;
    const redis = (0, redis_1.getRedis)();
    const lockKey = summaryLockKey(userId);
    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - 15);
    try {
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
        const lines = [
            "MeCove Summary (Past 15 Days)",
            `Generated at: ${now.toISOString()}`,
            `Messages: ${N}`,
            "",
        ];
        for (const m of messages) {
            if (!m.text || !m.text.trim())
                continue;
            lines.push(`${m.createdAt.toISOString()} - ${m.text.trim()}`);
        }
        if (lines.length === 4) {
            lines.push("No text messages found in this period.");
        }
        const pdfBytes = (0, pdf_1.buildSummaryPdf)(lines);
        const filename = `mecove-summary-${now.toISOString().slice(0, 10)}.pdf`;
        await (0, whatsapp_1.sendWhatsAppDocument)(channelUserKey, pdfBytes, filename, "Your summary is ready.");
        await prisma_1.prisma.summary.create({
            data: {
                userId,
                rangeStart,
                rangeEnd: now,
                status: "success",
                summaryText: `Summary PDF generated and sent (${N} messages).`,
                inputMessagesCount: N,
                inputHash,
            },
        });
    }
    finally {
        await redis.del(lockKey);
    }
}, { connection: (0, redis_1.getRedis)() });
// Reply worker
const replyWorker = new bullmq_1.Worker(replyQueue_1.REPLY_QUEUE_NAME, async (job) => {
    if (job.name !== replyQueue_1.JOB_NAME_GENERATE_REPLY) {
        logger_1.logger.warn("reply job ignored: wrong job name", { jobName: job.name });
        return;
    }
    const { userId, messageId, identityId, sourceMessageId, channelUserKey, messageText, messageTimestamp, } = job.data;
    const command = parseCommand(messageText);
    if (command) {
        let replyText = CHATLOG_SENT_TEXT;
        if (command === "/chatlog") {
            const chatlog = await buildAllTimeChatlogMarkdown(userId);
            const filename = `mecove-chatlog-${new Date().toISOString().slice(0, 10)}.md`;
            await (0, whatsapp_1.sendWhatsAppBufferDocument)(channelUserKey, Buffer.from(chatlog, "utf8"), filename, "text/plain", "Your chat log is ready.");
        }
        else if (command === "/clear") {
            await prisma_1.prisma.$transaction([
                prisma_1.prisma.summary.deleteMany({ where: { userId } }),
                prisma_1.prisma.message.deleteMany({ where: { userId } }),
            ]);
            await (0, redis_1.getRedis)().del(`messages:${userId}`, summaryLockKey(userId));
            replyText = CHAT_CLEARED_TEXT;
        }
        else {
            replyText = UNKNOWN_COMMAND_TEXT;
        }
        const messagesAfterCount = await (0, messageTracking_1.countMessagesAfter)(userId, messageTimestamp);
        const shouldSendContextual = messagesAfterCount > 1 || Date.now() - messageTimestamp > 10_000;
        const contextualMessageId = shouldSendContextual ? sourceMessageId : undefined;
        await (0, whatsapp_1.sendWhatsAppReply)(channelUserKey, replyText, contextualMessageId);
        await prisma_1.prisma.message.update({
            where: { id: messageId },
            data: {
                repliedAt: new Date(),
                replyText,
            },
        });
        return;
    }
    // Generate reply using LLM
    let replyText = "Noted.";
    let shouldGenerateSummary = false;
    try {
        const decision = await (0, ackReply_1.generateAckDecision)(userId, messageText);
        if (decision.replyText.trim().length > 0) {
            replyText = decision.replyText.trim();
        }
        shouldGenerateSummary = decision.shouldGenerateSummary;
    }
    catch (err) {
        logger_1.logger.warn("LLM reply generation failed, using fallback", err);
    }
    if (shouldGenerateSummary) {
        const redis = (0, redis_1.getRedis)();
        const lockKey = summaryLockKey(userId);
        const lockValue = JSON.stringify({ messageId, createdAt: new Date().toISOString() });
        const acquired = await redis.set(lockKey, lockValue, "EX", SUMMARY_LOCK_TTL_SECONDS, "NX");
        if (acquired) {
            replyText = SUMMARY_REQUEST_ACCEPTED_TEXT;
            try {
                await summaryQueue_1.summaryQueue.add(summaryQueue_1.JOB_NAME_GENERATE_SUMMARY, {
                    userId,
                    channelUserKey,
                    range: "last_15_days",
                });
                logger_1.logger.info("summary generation requested by user intent", {
                    userId,
                    messageId,
                });
            }
            catch (err) {
                await redis.del(lockKey);
                logger_1.logger.error("failed to enqueue summary generation", {
                    userId,
                    messageId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        else {
            replyText = SUMMARY_ALREADY_RUNNING_TEXT;
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
    const userId = job?.data?.userId;
    const channelUserKey = job?.data?.channelUserKey;
    if (userId) {
        void (0, redis_1.getRedis)().del(summaryLockKey(userId));
    }
    if (channelUserKey && /timed out/i.test(err.message)) {
        void (0, whatsapp_1.sendWhatsAppReply)(channelUserKey, SUMMARY_TIMEOUT_TEXT).catch((sendErr) => {
            logger_1.logger.error("failed to send summary timeout notification", {
                jobId: job?.id,
                error: sendErr instanceof Error ? sendErr.message : String(sendErr),
            });
        });
    }
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

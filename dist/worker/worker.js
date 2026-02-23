"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bullmq_1 = require("bullmq");
const prisma_1 = require("../infra/prisma");
const logger_1 = require("../infra/logger");
const redis_1 = require("../infra/redis");
const summaryQueue_1 = require("../queues/summaryQueue");
const replyQueue_1 = require("../queues/replyQueue");
const replyBatchQueue_1 = require("../queues/replyBatchQueue");
const ackReply_1 = require("../llm/ackReply");
const testFeedback_1 = require("../messages/testFeedback");
const whatsapp_1 = require("../infra/whatsapp");
const p0_1 = require("../summary/p0");
const p1_1 = require("../summary/p1");
const pipeline_1 = require("../summary/pipeline");
const redisArtifacts_1 = require("../summary/redisArtifacts");
const config_1 = require("../replyBatch/config");
const state_1 = require("../replyBatch/state");
// Fail fast on startup
if (!process.env.REDIS_URL?.trim()) {
    throw new Error("REDIS_URL is required. Set it in .env");
}
if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required. Set it in .env");
}
const SUMMARY_LOCK_TTL_SECONDS = 15 * 60;
const SUMMARY_REQUEST_ACCEPTED_TEXT = "I will generate a summary for past 15 days activity and send it to you in a bit. Please wait.";
const SUMMARY_ALREADY_RUNNING_TEXT = "Your previous summary is still being generated. Please wait.";
const SUMMARY_TIMEOUT_TEXT = "Summary generation timed out. Please request again.";
const CHATLOG_SENT_TEXT = "I have sent your chat log as an attachment.";
const CHAT_CLEARED_TEXT = "Your chat history has been cleared.";
const UNKNOWN_COMMAND_TEXT = "Unknown command. Available: /chatlog, /clear, /f";
const BUSY_NOTICE_TEXT = "Please wait, I am processing your previous message. Retry command in a moment.";
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
            continue;
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
function evaluateBatchDue(nowMs, startAtMs, lastAtMs) {
    const quietElapsed = nowMs - lastAtMs;
    const totalElapsed = nowMs - startAtMs;
    if (totalElapsed >= config_1.REPLY_BATCH_MAX_WAIT_MS) {
        return { dueReason: "max_cap", delayMs: 0 };
    }
    if (quietElapsed >= config_1.REPLY_BATCH_DEBOUNCE_MS) {
        return { dueReason: "quiet", delayMs: 0 };
    }
    const quietRemaining = config_1.REPLY_BATCH_DEBOUNCE_MS - quietElapsed;
    const capRemaining = config_1.REPLY_BATCH_MAX_WAIT_MS - totalElapsed;
    return {
        dueReason: null,
        delayMs: Math.max(1, Math.min(quietRemaining, capRemaining)),
    };
}
async function enqueueBatchFlush(userId, seq, delayMs) {
    await replyBatchQueue_1.replyBatchQueue.add(replyBatchQueue_1.JOB_NAME_FLUSH_REPLY_BATCH, { userId, seq }, { delay: Math.max(1, Math.floor(delayMs)) });
}
async function applySummaryIntent(userId, messageId, channelUserKey, shouldGenerateSummary, defaultReplyText) {
    if (!shouldGenerateSummary)
        return defaultReplyText;
    const redis = (0, redis_1.getRedis)();
    const lockKey = summaryLockKey(userId);
    const lockValue = JSON.stringify({ messageId, createdAt: new Date().toISOString() });
    const acquired = await redis.set(lockKey, lockValue, "EX", SUMMARY_LOCK_TTL_SECONDS, "NX");
    if (!acquired) {
        return SUMMARY_ALREADY_RUNNING_TEXT;
    }
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
        return SUMMARY_REQUEST_ACCEPTED_TEXT;
    }
    catch (err) {
        await redis.del(lockKey);
        logger_1.logger.error("failed to enqueue summary generation", {
            userId,
            messageId,
            error: err instanceof Error ? err.message : String(err),
        });
        return defaultReplyText;
    }
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
    let summaryId = null;
    let windowBundle = null;
    try {
        windowBundle = await (0, p0_1.buildWindowBundle)(userId, "Asia/Kolkata");
        const summary = await prisma_1.prisma.summary.create({
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
        const result = await (0, pipeline_1.generateSummaryPipeline)({
            userId,
            summaryId,
            timezone: "Asia/Kolkata",
            windowBundle,
        });
        const filename = `mecove-summary-${windowBundle.window.endDate}.pdf`;
        await (0, whatsapp_1.sendWhatsAppDocument)(channelUserKey, result.pdfBytes, filename, "Your summary is ready.");
        await prisma_1.prisma.summary.update({
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
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger_1.logger.error("summary generation failed", {
            userId,
            summaryId,
            error: reason,
        });
        let fallbackSent = false;
        try {
            if (!windowBundle) {
                windowBundle = await (0, p0_1.buildWindowBundle)(userId, "Asia/Kolkata");
            }
            const fallback = (0, p1_1.buildMinimalFallbackReport)(windowBundle);
            const fallbackFilename = `mecove-summary-${windowBundle.window.endDate}.pdf`;
            await (0, whatsapp_1.sendWhatsAppDocument)(channelUserKey, fallback.pdfBytes, fallbackFilename, "Your summary is ready.");
            if (summaryId) {
                await prisma_1.prisma.summary.update({
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
            }
            else {
                await prisma_1.prisma.summary.create({
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
        }
        catch (fallbackErr) {
            logger_1.logger.error("fallback summary generation failed", {
                userId,
                summaryId,
                error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            });
        }
        if (!fallbackSent) {
            if (summaryId) {
                await prisma_1.prisma.summary.update({
                    where: { id: summaryId },
                    data: {
                        status: "failed",
                        error: reason,
                    },
                });
            }
            else if (windowBundle) {
                await prisma_1.prisma.summary.create({
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
            }
            else {
                const now = new Date();
                const rangeStart = new Date(now);
                rangeStart.setDate(rangeStart.getDate() - 15);
                await prisma_1.prisma.summary.create({
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
    }
    finally {
        await redis.del(lockKey);
    }
}, { connection: (0, redis_1.getRedis)() });
// Command and busy-notice worker
const replyWorker = new bullmq_1.Worker(replyQueue_1.REPLY_QUEUE_NAME, async (job) => {
    if (job.name !== replyQueue_1.JOB_NAME_GENERATE_REPLY) {
        logger_1.logger.warn("reply job ignored: wrong job name", { jobName: job.name });
        return;
    }
    const { userId, messageId, channelUserKey, messageText, mode } = job.data;
    if (mode === "busy_notice") {
        await (0, whatsapp_1.sendWhatsAppReply)(channelUserKey, BUSY_NOTICE_TEXT);
        await prisma_1.prisma.message.update({
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
        logger_1.logger.warn("reply command job ignored: missing slash command", { messageId, userId });
        return;
    }
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
        await (0, redis_1.getRedis)().del(summaryLockKey(userId));
        await (0, state_1.clearReplyBatchState)(userId);
        await (0, redisArtifacts_1.clearSummaryArtifactsForUser)(userId);
        replyText = CHAT_CLEARED_TEXT;
    }
    else if (command === testFeedback_1.TEST_FEEDBACK_COMMAND) {
        replyText = testFeedback_1.TEST_FEEDBACK_SUCCESS_REPLY;
    }
    else {
        replyText = UNKNOWN_COMMAND_TEXT;
    }
    await (0, whatsapp_1.sendWhatsAppReply)(channelUserKey, replyText);
    if (command !== "/clear") {
        await prisma_1.prisma.message.update({
            where: { id: messageId },
            data: {
                repliedAt: new Date(),
                replyText,
            },
        });
    }
}, {
    connection: (0, redis_1.getRedis)(),
    concurrency: 5,
});
// Debounced batch flush worker
const replyBatchWorker = new bullmq_1.Worker(replyBatchQueue_1.REPLY_BATCH_QUEUE_NAME, async (job) => {
    if (job.name !== replyBatchQueue_1.JOB_NAME_FLUSH_REPLY_BATCH) {
        logger_1.logger.warn("reply batch job ignored: wrong job name", { jobName: job.name });
        return;
    }
    const { userId, seq: jobSeq } = job.data;
    const timing = await (0, state_1.getBatchTiming)(userId);
    if (!timing)
        return;
    const nowMs = Date.now();
    const due = evaluateBatchDue(nowMs, timing.startAtMs, timing.lastAtMs);
    if (!due.dueReason) {
        await enqueueBatchFlush(userId, timing.seq, due.delayMs);
        return;
    }
    const lockToken = await (0, state_1.acquireReplyBatchFlushLock)(userId);
    if (!lockToken) {
        return;
    }
    const lockedTiming = await (0, state_1.getBatchTiming)(userId);
    if (!lockedTiming) {
        await (0, state_1.releaseReplyBatchFlushLock)(userId, lockToken);
        return;
    }
    const lockedDue = evaluateBatchDue(Date.now(), lockedTiming.startAtMs, lockedTiming.lastAtMs);
    if (!lockedDue.dueReason) {
        await enqueueBatchFlush(userId, lockedTiming.seq, lockedDue.delayMs);
        await (0, state_1.releaseReplyBatchFlushLock)(userId, lockToken);
        return;
    }
    let claimedBatch = null;
    let replySent = false;
    try {
        claimedBatch = await (0, state_1.claimBatchAtomically)(userId);
        if (!claimedBatch)
            return;
        const messages = await prisma_1.prisma.message.findMany({
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
        if (messages.length === 0)
            return;
        const combinedText = messages
            .map((m) => (m.text ?? "").trim())
            .filter((text) => text.length > 0 && !text.startsWith("/"))
            .join("\n");
        if (combinedText.length === 0)
            return;
        if (config_1.WHATSAPP_TYPING_INDICATOR_ENABLED) {
            try {
                await (0, whatsapp_1.sendWhatsAppTypingIndicator)(claimedBatch.meta.channelUserKey, claimedBatch.meta.latestSourceMessageId);
            }
            catch (err) {
                logger_1.logger.warn("typing indicator call failed; continuing without indicator", {
                    userId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        let replyText = "Got it.";
        let shouldGenerateSummary = false;
        try {
            const decision = await (0, ackReply_1.generateAckDecision)(userId, combinedText);
            if (decision.replyText.trim().length > 0) {
                replyText = decision.replyText.trim();
            }
            shouldGenerateSummary = decision.shouldGenerateSummary;
            logger_1.logger.info("ack decision summary flag", {
                userId,
                shouldGenerateSummary,
                batchMessageCount: combinedText ? combinedText.split(/\n/).length : 0,
            });
        }
        catch (err) {
            logger_1.logger.warn("LLM batch reply generation failed, using fallback", err);
        }
        replyText = await applySummaryIntent(userId, claimedBatch.meta.latestMessageId, claimedBatch.meta.channelUserKey, shouldGenerateSummary, replyText);
        await (0, whatsapp_1.sendWhatsAppReply)(claimedBatch.meta.channelUserKey, replyText);
        replySent = true;
        const latestMessageId = messages.some((m) => m.id === claimedBatch?.meta.latestMessageId)
            ? claimedBatch.meta.latestMessageId
            : messages[messages.length - 1]?.id;
        if (latestMessageId) {
            try {
                await prisma_1.prisma.message.update({
                    where: { id: latestMessageId },
                    data: {
                        repliedAt: new Date(),
                        replyText,
                    },
                });
            }
            catch (err) {
                logger_1.logger.error("failed to persist latest batch message reply metadata", {
                    userId,
                    latestMessageId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        logger_1.logger.info("reply batch flushed", {
            userId,
            batchCount: claimedBatch.ids.length,
            dueReason: lockedDue.dueReason,
            waitMs: nowMs - claimedBatch.meta.startAtMs,
            jobSeq,
            currentSeq: lockedTiming.seq,
        });
    }
    catch (err) {
        if (claimedBatch && !replySent) {
            try {
                await (0, state_1.restoreClaimedBatch)(userId, claimedBatch);
                await enqueueBatchFlush(userId, claimedBatch.meta.seq, config_1.REPLY_BATCH_DEBOUNCE_MS);
            }
            catch (restoreErr) {
                logger_1.logger.error("failed to restore claimed batch after processing error", {
                    userId,
                    error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
                });
            }
        }
        throw err;
    }
    finally {
        await (0, state_1.releaseReplyBatchFlushLock)(userId, lockToken);
    }
}, {
    connection: (0, redis_1.getRedis)(),
    concurrency: 5,
});
replyWorker.on("failed", (job, err) => {
    logger_1.logger.error("reply job failed", {
        jobId: job?.id,
        error: err.message,
    });
});
replyBatchWorker.on("failed", (job, err) => {
    logger_1.logger.error("reply batch job failed", {
        jobId: job?.id,
        error: err.message,
        userId: job?.data?.userId,
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
    await Promise.all([summaryWorker.close(), replyWorker.close(), replyBatchWorker.close()]);
    await prisma_1.prisma.$disconnect();
    process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
logger_1.logger.info("worker started (summary + reply + reply_batch queues)");

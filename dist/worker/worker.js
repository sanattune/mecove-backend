"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_crypto_1 = require("node:crypto");
const bullmq_1 = require("bullmq");
const prisma_1 = require("../infra/prisma");
const logger_1 = require("../infra/logger");
const redis_1 = require("../infra/redis");
const summaryQueue_1 = require("../queues/summaryQueue");
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
const worker = new bullmq_1.Worker(summaryQueue_1.SUMMARY_QUEUE_NAME, async (job) => {
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
    logger_1.logger.info("generated summary for user", userId, "messages:", N);
}, { connection: (0, redis_1.getRedis)() });
async function shutdown() {
    await worker.close();
    await prisma_1.prisma.$disconnect();
    process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
logger_1.logger.info("worker started");

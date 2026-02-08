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

const worker = new Worker<GenerateSummaryPayload>(
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

    logger.info("generated summary for user", userId, "messages:", N);
  },
  { connection: getRedis() }
);

async function shutdown() {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

logger.info("worker started");

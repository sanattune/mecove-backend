import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../../infra/prisma";
import { getRedis } from "../../../infra/redis";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import { consentConfig } from "../../../consent/config";
import { summaryLockKey, summaryRangePromptKey, summaryTypePromptKey, summaryChosenTypeKey } from "../../../summary/keys";
import { clearReplyBatchState } from "../../../replyBatch/state";
import { clearSummaryArtifactsForUser } from "../../../summary/redisArtifacts";

export async function handleGetStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "getStats" });
  const userId = request.userId!;
  try {
    const [messageCount, earliest, lastSummary] = await Promise.all([
      prisma.message.count({ where: { userId, category: { not: "test_feedback" } } }),
      prisma.message.findFirst({
        where: { userId, category: { not: "test_feedback" } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.summary.findFirst({
        where: { userId, status: { in: ["success", "success_fallback"] } },
        orderBy: { createdAt: "desc" },
        select: { reportType: true, createdAt: true },
      }),
    ]);

    reply.code(200).send({
      messageCount,
      memberSince: earliest?.createdAt.toISOString() ?? null,
      lastReport: lastSummary
        ? { type: lastSummary.reportType, createdAt: lastSummary.createdAt.toISOString() }
        : null,
    });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "getStats" });
    log.error({ err }, "getStats failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleDeleteAccountData(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "deleteAccountData" });
  const userId = request.userId!;
  try {
    await prisma.$transaction([
      prisma.summary.deleteMany({ where: { userId } }),
      prisma.message.deleteMany({ where: { userId } }),
    ]);
    const redis = getRedis();
    await redis.del(
      summaryLockKey(userId),
      summaryRangePromptKey(userId),
      summaryTypePromptKey(userId),
      summaryChosenTypeKey(userId)
    );
    await clearReplyBatchState(userId);
    await clearSummaryArtifactsForUser(userId);
    log.info({ userId }, "account data deleted");
    reply.code(200).send({ success: true });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "deleteAccountData" });
    log.error({ err }, "deleteAccountData failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleGetPrivacy(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.code(200).send({
    message: consentConfig.mvp.message,
    link: consentConfig.mvp.link ?? null,
  });
}

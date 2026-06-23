import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../../infra/prisma";
import { getRedis } from "../../../infra/redis";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import { consentConfig } from "../../../consent/config";
import { insightLockKey, insightRangePromptKey, insightTypePromptKey, insightChosenTypeKey } from "../../../insight/keys";
import { clearReplyBatchState } from "../../../replyBatch/state";
import { clearInsightArtifactsForUser } from "../../../insight/redisArtifacts";

export async function handleGetStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "getStats" });
  const userId = request.userId!;
  try {
    const [messageCount, earliest, lastInsight] = await Promise.all([
      prisma.message.count({ where: { userId, category: { not: "test_feedback" } } }),
      prisma.message.findFirst({
        where: { userId, category: { not: "test_feedback" } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.insight.findFirst({
        where: { userId, status: { in: ["success", "success_fallback"] } },
        orderBy: { createdAt: "desc" },
        select: { insightType: true, createdAt: true },
      }),
    ]);

    reply.code(200).send({
      messageCount,
      memberSince: earliest?.createdAt.toISOString() ?? null,
      lastInsight: lastInsight
        ? { type: lastInsight.insightType, createdAt: lastInsight.createdAt.toISOString() }
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
      prisma.insight.deleteMany({ where: { userId } }),
      prisma.message.deleteMany({ where: { userId } }),
    ]);
    const redis = getRedis();
    await redis.del(
      insightLockKey(userId),
      insightRangePromptKey(userId),
      insightTypePromptKey(userId),
      insightChosenTypeKey(userId)
    );
    await clearReplyBatchState(userId);
    await clearInsightArtifactsForUser(userId);
    log.info({ userId }, "account data deleted");
    reply.code(200).send({ success: true });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "deleteAccountData" });
    log.error({ err }, "deleteAccountData failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleGetPrivacy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "getPrivacy" });
  const userId = request.userId!;
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { privacyAcceptedVersion: true } });
    const privacyAccepted = user.privacyAcceptedVersion === consentConfig.mvp.version;
    reply.code(200).send({
      message: consentConfig.mvp.message,
      link: consentConfig.mvp.link ?? null,
      privacyAccepted,
    });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "getPrivacy" });
    log.error({ err }, "getPrivacy failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleAcceptPrivacy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "acceptPrivacy" });
  const userId = request.userId!;
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        privacyAcceptedAt: new Date(),
        privacyAcceptedVersion: consentConfig.mvp.version,
      },
    });
    reply.code(200).send({ success: true });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "acceptPrivacy" });
    log.error({ err }, "acceptPrivacy failed");
    reply.code(500).send(Errors.internal());
  }
}

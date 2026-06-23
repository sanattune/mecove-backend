import crypto from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { getRedis } from "../../../infra/redis";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import { insightQueue, JOB_NAME_GENERATE_INSIGHT } from "../../../queues/insightQueue";
import { insightLockKey } from "../../../insight/keys";

const INSIGHT_LOCK_TTL_SECONDS = 15 * 60;

const GenerateInsightSchema = z.object({
  type: z.enum(["sessionbridge", "myself_lately"]),
  range: z.enum(["last_7_days", "last_15_days", "last_30_days"]),
});

export async function handleGenerateInsight(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "generateInsight" });
  const userId = request.userId!;
  try {
    const parsed = GenerateInsightSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { type: insightType, range } = parsed.data;
    const redis = getRedis();
    const lockKey = insightLockKey(userId);

    const insightId = crypto.randomUUID();
    const lockValue = JSON.stringify({ insightId, createdAt: new Date().toISOString() });
    const acquired = await redis.set(lockKey, lockValue, "EX", INSIGHT_LOCK_TTL_SECONDS, "NX");
    if (!acquired) {
      reply.code(409).send(Errors.conflict("An insight is already being generated. Try again shortly."));
      return;
    }

    await prisma.insight.create({
      data: {
        id: insightId,
        userId,
        rangeStart: new Date(),
        rangeEnd: new Date(),
        status: "queued",
        insightType,
        channel: "app",
      },
    });

    await insightQueue.add(JOB_NAME_GENERATE_INSIGHT, {
      userId,
      channelUserKey: userId,
      range,
      insightType,
      channel: "app",
      insightId,
    });

    log.info({ userId, insightType, range, insightId }, "insight queued for app");
    reply.code(202).send({ insightId, status: "queued" });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "generateInsight" });
    log.error({ err }, "generateInsight failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleGetInsight(
  request: FastifyRequest<{ Params: { insightId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "getInsight" });
  const userId = request.userId!;
  try {
    const { insightId } = request.params;
    const insight = await prisma.insight.findFirst({
      where: { id: insightId, userId },
      select: { id: true, status: true, insightType: true, rangeStart: true, rangeEnd: true, createdAt: true },
    });
    if (!insight) {
      reply.code(404).send(Errors.notFound("Insight not found."));
      return;
    }
    reply.code(200).send({
      id: insight.id,
      status: insight.status,
      insightType: insight.insightType,
      rangeStart: insight.rangeStart.toISOString(),
      rangeEnd: insight.rangeEnd.toISOString(),
      createdAt: insight.createdAt.toISOString(),
    });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "getInsight" });
    log.error({ err }, "getInsight failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleGetInsightPdf(
  request: FastifyRequest<{ Params: { insightId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "getInsightPdf" });
  const userId = request.userId!;
  try {
    const { insightId } = request.params;
    const insight = await prisma.insight.findFirst({
      where: { id: insightId, userId, channel: "app" },
      select: { status: true, pdfBytes: true, insightType: true, rangeEnd: true },
    });
    if (!insight || !insight.pdfBytes) {
      reply.code(404).send(Errors.notFound("PDF not available. Insight may still be processing or failed."));
      return;
    }
    const prefix = insight.insightType === "myself_lately" ? "myself-lately" : "sessionbridge";
    const date = insight.rangeEnd.toISOString().slice(0, 10);
    reply
      .code(200)
      .type("application/pdf")
      .header("Content-Disposition", `attachment; filename="${prefix}-${date}.pdf"`)
      .header("Content-Length", insight.pdfBytes.length)
      .send(insight.pdfBytes);
    log.info({ userId, insightId }, "pdf served");
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "getInsightPdf" });
    log.error({ err }, "getInsightPdf failed");
    reply.code(500).send(Errors.internal());
  }
}

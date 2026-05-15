import crypto from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { getRedis } from "../../../infra/redis";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import { summaryQueue, JOB_NAME_GENERATE_SUMMARY } from "../../../queues/summaryQueue";
import { summaryLockKey } from "../../../summary/keys";

const SUMMARY_LOCK_TTL_SECONDS = 15 * 60;

const GenerateSummarySchema = z.object({
  type: z.enum(["sessionbridge", "myself_lately"]),
  range: z.enum(["last_7_days", "last_15_days", "last_30_days"]),
});

export async function handleGenerateSummary(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "generateSummary" });
  const userId = request.userId!;
  try {
    const parsed = GenerateSummarySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { type: reportType, range } = parsed.data;
    const redis = getRedis();
    const lockKey = summaryLockKey(userId);

    const summaryId = crypto.randomUUID();
    const lockValue = JSON.stringify({ summaryId, createdAt: new Date().toISOString() });
    const acquired = await redis.set(lockKey, lockValue, "EX", SUMMARY_LOCK_TTL_SECONDS, "NX");
    if (!acquired) {
      reply.code(409).send(Errors.conflict("A report is already being generated. Try again shortly."));
      return;
    }

    await prisma.summary.create({
      data: {
        id: summaryId,
        userId,
        rangeStart: new Date(),
        rangeEnd: new Date(),
        status: "queued",
        reportType,
        channel: "app",
      },
    });

    await summaryQueue.add(JOB_NAME_GENERATE_SUMMARY, {
      userId,
      channelUserKey: userId,
      range,
      reportType,
      channel: "app",
      summaryId,
    });

    log.info({ userId, reportType, range, summaryId }, "summary queued for app");
    reply.code(202).send({ summaryId, status: "queued" });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "generateSummary" });
    log.error({ err }, "generateSummary failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleGetSummary(
  request: FastifyRequest<{ Params: { summaryId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "getSummary" });
  const userId = request.userId!;
  try {
    const { summaryId } = request.params;
    const summary = await prisma.summary.findFirst({
      where: { id: summaryId, userId },
      select: { id: true, status: true, reportType: true, rangeStart: true, rangeEnd: true, createdAt: true },
    });
    if (!summary) {
      reply.code(404).send(Errors.notFound("Summary not found."));
      return;
    }
    reply.code(200).send({
      id: summary.id,
      status: summary.status,
      reportType: summary.reportType,
      rangeStart: summary.rangeStart.toISOString(),
      rangeEnd: summary.rangeEnd.toISOString(),
      createdAt: summary.createdAt.toISOString(),
    });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "getSummary" });
    log.error({ err }, "getSummary failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleGetSummaryPdf(
  request: FastifyRequest<{ Params: { summaryId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "getSummaryPdf" });
  const userId = request.userId!;
  try {
    const { summaryId } = request.params;
    const summary = await prisma.summary.findFirst({
      where: { id: summaryId, userId, channel: "app" },
      select: { status: true, pdfBytes: true, reportType: true, rangeEnd: true },
    });
    if (!summary || !summary.pdfBytes) {
      reply.code(404).send(Errors.notFound("PDF not available. Report may still be processing or failed."));
      return;
    }
    const prefix = summary.reportType === "myself_lately" ? "myself-lately" : "sessionbridge";
    const date = summary.rangeEnd.toISOString().slice(0, 10);
    reply
      .code(200)
      .type("application/pdf")
      .header("Content-Disposition", `attachment; filename="${prefix}-${date}.pdf"`)
      .header("Content-Length", summary.pdfBytes.length)
      .send(summary.pdfBytes);
    log.info({ userId, summaryId }, "pdf served");
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "getSummaryPdf" });
    log.error({ err }, "getSummaryPdf failed");
    reply.code(500).send(Errors.internal());
  }
}

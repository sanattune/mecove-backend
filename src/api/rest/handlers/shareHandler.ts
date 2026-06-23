import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import { shareInsightToEngagement } from "../../../professional/sharing";

const SHAREABLE_STATUSES = ["success", "success_fallback"];

const ShareSchema = z.object({ insightId: z.string().uuid() });
const AutoSendSchema = z.object({ enabled: z.boolean() });

function shareDto(s: { id: string; engagementId: string; insightId: string; sharedAt: Date; revokedAt: Date | null; autoSent: boolean }) {
  return {
    id: s.id,
    engagementId: s.engagementId,
    insightId: s.insightId,
    sharedAt: s.sharedAt.toISOString(),
    revokedAt: s.revokedAt?.toISOString() ?? null,
    autoSent: s.autoSent,
  };
}

// POST /engagements/:engagementId/shares — client shares one of their Insights with an
// active engagement (D6; any insight type — the SessionBridge-only whitelist was
// dropped). The professional still cannot pull or see raw journal.
export async function handleShareInsight(
  request: FastifyRequest<{ Params: { engagementId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "shareInsight" });
  const userId = request.userId!;
  try {
    const parsed = ShareSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { engagementId } = request.params;
    const { insightId } = parsed.data;

    const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } });
    if (!engagement || engagement.clientUserId !== userId) {
      reply.code(404).send(Errors.notFound("Engagement not found."));
      return;
    }
    if (engagement.status !== "active") {
      reply.code(409).send(Errors.conflict("Engagement is not active."));
      return;
    }
    const insight = await prisma.insight.findUnique({ where: { id: insightId } });
    if (!insight || insight.userId !== userId) {
      reply.code(404).send(Errors.notFound("Insight not found."));
      return;
    }
    if (!SHAREABLE_STATUSES.includes(insight.status)) {
      reply.code(409).send(Errors.conflict("Insight is not ready to share."));
      return;
    }

    const share = await shareInsightToEngagement(engagementId, insightId);
    log.info({ userId, engagementId, insightId }, "insight shared");
    reply.code(201).send(shareDto(share));
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "shareInsight" });
    log.error({ err }, "shareInsight failed");
    reply.code(500).send(Errors.internal());
  }
}

// DELETE /engagements/:engagementId/shares/:insightId — client unshare (D12). Sets
// revokedAt; idempotent. Engagement and other shares are untouched.
export async function handleUnshareInsight(
  request: FastifyRequest<{ Params: { engagementId: string; insightId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "unshareInsight" });
  const userId = request.userId!;
  try {
    const { engagementId, insightId } = request.params;
    const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } });
    if (!engagement || engagement.clientUserId !== userId) {
      reply.code(404).send(Errors.notFound("Engagement not found."));
      return;
    }
    const share = await prisma.insightShare.findUnique({
      where: { engagementId_insightId: { engagementId, insightId } },
    });
    if (!share) {
      reply.code(404).send(Errors.notFound("Share not found."));
      return;
    }
    if (!share.revokedAt) {
      await prisma.insightShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
    }
    log.info({ userId, engagementId, insightId }, "insight unshared");
    reply.code(200).send({ success: true });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "unshareInsight" });
    log.error({ err }, "unshareInsight failed");
    reply.code(500).send(Errors.internal());
  }
}

// PUT /engagements/:engagementId/auto-send — client toggles auto-send of new
// SessionBridge insights to this engagement (D6/D28). Future insights only.
export async function handleSetAutoSend(
  request: FastifyRequest<{ Params: { engagementId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "setAutoSend" });
  const userId = request.userId!;
  try {
    const parsed = AutoSendSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { engagementId } = request.params;
    const { enabled } = parsed.data;
    const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } });
    if (!engagement || engagement.clientUserId !== userId) {
      reply.code(404).send(Errors.notFound("Engagement not found."));
      return;
    }
    if (engagement.status === "ended") {
      reply.code(409).send(Errors.conflict("Engagement has ended."));
      return;
    }
    await prisma.engagement.update({ where: { id: engagementId }, data: { autoSendSessionBridge: enabled } });
    log.info({ userId, engagementId, enabled }, "auto-send toggled");
    reply.code(200).send({ engagementId, autoSendSessionBridge: enabled });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "setAutoSend" });
    log.error({ err }, "setAutoSend failed");
    reply.code(500).send(Errors.internal());
  }
}

// Resolve a professional's access to an engagement's shared insights (D23): the
// engagement must belong to one of the caller's profiles AND be active. Returns the
// engagement row, or null (caller gets 404 / empty).
async function resolveProAccess(engagementId: string, userId: string) {
  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
    include: { professional: true },
  });
  if (!engagement || engagement.professional.userId !== userId) return null;
  return engagement;
}

// GET /professional/engagements/:engagementId/insights — the insights the client has
// shared and not revoked, only while the engagement is active. Metadata only (no PDF
// bytes); no access to raw journal or unshared insights.
export async function handleListSharedInsights(
  request: FastifyRequest<{ Params: { engagementId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "listSharedInsights" });
  const userId = request.userId!;
  try {
    const { engagementId } = request.params;
    const engagement = await resolveProAccess(engagementId, userId);
    if (!engagement) {
      reply.code(404).send(Errors.notFound("Engagement not found."));
      return;
    }
    if (engagement.status !== "active") {
      reply.code(200).send({ insights: [] });
      return;
    }
    const shares = await prisma.insightShare.findMany({
      where: { engagementId, revokedAt: null },
      orderBy: { sharedAt: "desc" },
      include: {
        insight: { select: { id: true, insightType: true, status: true, rangeStart: true, rangeEnd: true, createdAt: true } },
      },
    });
    const insights = shares.map((s) => ({
      insightId: s.insight.id,
      insightType: s.insight.insightType,
      status: s.insight.status,
      rangeStart: s.insight.rangeStart.toISOString(),
      rangeEnd: s.insight.rangeEnd.toISOString(),
      createdAt: s.insight.createdAt.toISOString(),
      sharedAt: s.sharedAt.toISOString(),
      autoSent: s.autoSent,
    }));
    reply.code(200).send({ insights });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "listSharedInsights" });
    log.error({ err }, "listSharedInsights failed");
    reply.code(500).send(Errors.internal());
  }
}

// GET /professional/engagements/:engagementId/insights/:insightId/pdf — the PDF of a
// shared insight, gated by the same derived access (active engagement + non-revoked).
export async function handleGetSharedInsightPdf(
  request: FastifyRequest<{ Params: { engagementId: string; insightId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "getSharedInsightPdf" });
  const userId = request.userId!;
  try {
    const { engagementId, insightId } = request.params;
    const engagement = await resolveProAccess(engagementId, userId);
    if (!engagement || engagement.status !== "active") {
      reply.code(404).send(Errors.notFound("Insight not available."));
      return;
    }
    const share = await prisma.insightShare.findUnique({
      where: { engagementId_insightId: { engagementId, insightId } },
    });
    if (!share || share.revokedAt) {
      reply.code(404).send(Errors.notFound("Insight not available."));
      return;
    }
    const insight = await prisma.insight.findUnique({
      where: { id: insightId },
      select: { pdfBytes: true, insightType: true, rangeEnd: true },
    });
    if (!insight || !insight.pdfBytes) {
      reply.code(404).send(Errors.notFound("PDF not available."));
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
    log.info({ userId, engagementId, insightId }, "shared insight pdf served");
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "getSharedInsightPdf" });
    log.error({ err }, "getSharedInsightPdf failed");
    reply.code(500).send(Errors.internal());
  }
}

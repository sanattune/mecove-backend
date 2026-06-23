import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";

// Async trust badge (D15): verification is reviewed by the team out of band and is
// NON-BLOCKING — client-accept is the real safety gate. These admin endpoints just let
// the team set/list the badge. verificationStatus is already surfaced on every profile
// read (professional + client engagement views).

const VERIFICATION_STATUSES = ["pending", "verified", "rejected"] as const;
const SetVerificationSchema = z.object({ verificationStatus: z.enum(VERIFICATION_STATUSES) });
const ListQuerySchema = z.object({ status: z.enum(VERIFICATION_STATUSES).optional() });

// GET /admin/professional-profiles?status= — review queue. Includes the owner's phone
// + name so the reviewer knows who they're verifying.
export async function handleListProfilesForReview(
  request: FastifyRequest<{ Querystring: { status?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "adminListProfiles" });
  try {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const profiles = await prisma.professionalProfile.findMany({
      where: parsed.data.status ? { verificationStatus: parsed.data.status } : {},
      orderBy: { createdAt: "asc" },
      include: { user: { include: { identities: true } } },
    });
    const result = profiles.map((p) => {
      const id = p.user.identities.find((i) => i.channel === "app") ?? p.user.identities[0];
      return {
        id: p.id,
        userId: p.userId,
        professionalType: p.professionalType,
        displayName: p.displayName,
        additionalTitle: p.additionalTitle,
        verificationStatus: p.verificationStatus,
        createdAt: p.createdAt.toISOString(),
        owner: { phone: id?.channelUserKey ?? null, displayName: id?.displayName ?? null },
      };
    });
    reply.code(200).send({ profiles: result });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "adminListProfiles" });
    log.error({ err }, "adminListProfiles failed");
    reply.code(500).send(Errors.internal());
  }
}

// PATCH /admin/professional-profiles/:profileId/verification — set the badge.
export async function handleSetVerificationStatus(
  request: FastifyRequest<{ Params: { profileId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "adminSetVerification" });
  try {
    const parsed = SetVerificationSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { profileId } = request.params;
    const existing = await prisma.professionalProfile.findUnique({ where: { id: profileId } });
    if (!existing) {
      reply.code(404).send(Errors.notFound("Professional profile not found."));
      return;
    }
    const updated = await prisma.professionalProfile.update({
      where: { id: profileId },
      data: { verificationStatus: parsed.data.verificationStatus },
    });
    log.info({ profileId, verificationStatus: updated.verificationStatus }, "verification status set");
    reply.code(200).send({
      id: updated.id,
      professionalType: updated.professionalType,
      displayName: updated.displayName,
      additionalTitle: updated.additionalTitle,
      verificationStatus: updated.verificationStatus,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "adminSetVerification" });
    log.error({ err }, "adminSetVerification failed");
    reply.code(500).send(Errors.internal());
  }
}

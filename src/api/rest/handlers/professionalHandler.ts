import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";

// Lean by design (D13): the load-bearing field is professionalType. Extra practice
// metadata (bio, practiceName, email) is deferred until a real need surfaces.
const CreateProfileSchema = z.object({
  professionalType: z.enum(["therapist", "counsellor", "coach"]),
  displayName: z.string().trim().min(1).max(120),
  additionalTitle: z.string().trim().max(120).optional(),
});

type ProfileDto = {
  id: string;
  professionalType: string;
  displayName: string;
  additionalTitle: string | null;
  verificationStatus: string;
  createdAt: string;
};

function toDto(p: {
  id: string;
  professionalType: string;
  displayName: string;
  additionalTitle: string | null;
  verificationStatus: string;
  createdAt: Date;
}): ProfileDto {
  return {
    id: p.id,
    professionalType: p.professionalType,
    displayName: p.displayName,
    additionalTitle: p.additionalTitle,
    verificationStatus: p.verificationStatus,
    createdAt: p.createdAt.toISOString(),
  };
}

// POST /professional/profiles — self-serve onboarding (D15). A User may hold several
// profiles (D3); creating one flips the denormalized User.isProfessional flag.
export async function handleCreateProfessionalProfile(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "createProfessionalProfile" });
  const userId = request.userId!;
  try {
    const parsed = CreateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { professionalType, displayName, additionalTitle } = parsed.data;

    const profile = await prisma.$transaction(async (tx) => {
      const created = await tx.professionalProfile.create({
        data: {
          userId,
          professionalType,
          displayName,
          additionalTitle: additionalTitle ?? null,
        },
      });
      // Keep the denormalized flag in sync (source of truth = profile rows).
      await tx.user.update({ where: { id: userId }, data: { isProfessional: true } });
      return created;
    });

    log.info({ userId, profileId: profile.id, professionalType }, "professional profile created");
    reply.code(201).send(toDto(profile));
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "createProfessionalProfile" });
    log.error({ err }, "createProfessionalProfile failed");
    reply.code(500).send(Errors.internal());
  }
}

// GET /professional/profiles — the caller's own profiles (empty list if none).
export async function handleListProfessionalProfiles(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "listProfessionalProfiles" });
  const userId = request.userId!;
  try {
    const profiles = await prisma.professionalProfile.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    reply.code(200).send({ profiles: profiles.map(toDto) });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "listProfessionalProfiles" });
    log.error({ err }, "listProfessionalProfiles failed");
    reply.code(500).send(Errors.internal());
  }
}

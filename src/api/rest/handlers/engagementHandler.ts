import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";

const E164 = /^\+[1-9]\d{6,14}$/;

const CreateEngagementSchema = z.object({
  professionalId: z.string().uuid(),
  clientPhone: z.string().regex(E164, "clientPhone must be E.164 (e.g. +919876543210)"),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

type ClientSummary = { userId: string; phone: string | null; displayName: string | null };

type EngagementDto = {
  id: string;
  professionalId: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  autoSendSessionBridge: boolean;
  acceptedAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  createdAt: string;
  // Either the linked client (once they exist) or the pending invite phone (D17).
  client: ClientSummary | null;
  inviteePhone: string | null;
};

type EngagementRow = {
  id: string;
  professionalId: string;
  clientUserId: string | null;
  inviteePhone: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  autoSendSessionBridge: boolean;
  acceptedAt: Date | null;
  endedAt: Date | null;
  endedBy: string | null;
  createdAt: Date;
  clientUser?: { id: string; identities: { channel: string; channelUserKey: string; displayName: string | null }[] } | null;
};

function clientSummary(row: EngagementRow): ClientSummary | null {
  if (!row.clientUser) return null;
  // Prefer the app identity for the phone/name; fall back to the first identity.
  const ids = row.clientUser.identities;
  const pick = ids.find((i) => i.channel === "app") ?? ids[0];
  return {
    userId: row.clientUser.id,
    phone: pick?.channelUserKey ?? null,
    displayName: pick?.displayName ?? null,
  };
}

function toDto(row: EngagementRow): EngagementDto {
  return {
    id: row.id,
    professionalId: row.professionalId,
    status: row.status,
    startDate: row.startDate?.toISOString() ?? null,
    endDate: row.endDate?.toISOString() ?? null,
    autoSendSessionBridge: row.autoSendSessionBridge,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    endedBy: row.endedBy,
    createdAt: row.createdAt.toISOString(),
    client: clientSummary(row),
    inviteePhone: row.inviteePhone,
  };
}

// POST /professional/engagements — Pro opens an engagement against a client (D4).
// add (client already has an account, matched by phone) OR invite (no account yet →
// pending invite keyed by phone, reconciled on signup, D17/D26). Always starts
// pending; the client must accept before any data flows (D5).
export async function handleCreateEngagement(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "createEngagement" });
  const userId = request.userId!;
  try {
    const parsed = CreateEngagementSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { professionalId, clientPhone, startDate, endDate } = parsed.data;

    // Ownership: the profile must belong to the caller (D3 — a User's own profile).
    const profile = await prisma.professionalProfile.findUnique({ where: { id: professionalId } });
    if (!profile || profile.userId !== userId) {
      reply.code(404).send(Errors.notFound("Professional profile not found."));
      return;
    }

    if (endDate && startDate && new Date(endDate) <= new Date(startDate)) {
      reply.code(400).send(Errors.validation("endDate must be after startDate."));
      return;
    }

    // Resolve the client: existing account (any channel) → add; else → invite (D17).
    const identity = await prisma.identity.findFirst({ where: { channelUserKey: clientPhone } });
    const clientUserId = identity?.userId ?? null;

    // Duplicate guard (D24): one live (pending|active) engagement per pro↔client pair.
    const dupe = await prisma.engagement.findFirst({
      where: {
        professionalId,
        status: { in: ["pending", "active"] },
        ...(clientUserId ? { clientUserId } : { inviteePhone: clientPhone }),
      },
    });
    if (dupe) {
      reply.code(409).send(Errors.conflict("An active or pending engagement already exists with this client."));
      return;
    }

    const created = await prisma.engagement.create({
      data: {
        professionalId,
        clientUserId,
        inviteePhone: clientUserId ? null : clientPhone,
        status: "pending",
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
      include: { clientUser: { include: { identities: true } } },
    });

    log.info({ userId, professionalId, engagementId: created.id, mode: clientUserId ? "add" : "invite" }, "engagement created");
    reply.code(201).send(toDto(created));
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "createEngagement" });
    log.error({ err }, "createEngagement failed");
    reply.code(500).send(Errors.internal());
  }
}

// GET /professional/engagements — all engagements across the caller's profiles, with
// the linked client's profile for active/accepted ones (D7).
export async function handleListProfessionalEngagements(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "listProfessionalEngagements" });
  const userId = request.userId!;
  try {
    const engagements = await prisma.engagement.findMany({
      where: { professional: { userId } },
      orderBy: { createdAt: "desc" },
      include: { clientUser: { include: { identities: true } } },
    });
    reply.code(200).send({ engagements: engagements.map(toDto) });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "listProfessionalEngagements" });
    log.error({ err }, "listProfessionalEngagements failed");
    reply.code(500).send(Errors.internal());
  }
}

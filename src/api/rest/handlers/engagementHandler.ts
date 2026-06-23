import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import { sendProInviteWhatsApp } from "../../../professional/notify";

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

    // Phase 6 B1 (D17b): cold phone → send the WhatsApp invite. Best-effort — a send
    // failure must not fail engagement creation (the invite is still reconciled on signup).
    if (!clientUserId) {
      try {
        await sendProInviteWhatsApp(clientPhone, profile.professionalType, profile.displayName);
      } catch (notifyErr) {
        captureException(notifyErr, { requestId: request.id, handler: "createEngagement", phase: "invite" });
        log.warn({ engagementId: created.id, err: notifyErr }, "pro invite WhatsApp send failed (non-fatal)");
      }
    }

    reply.code(201).send(toDto(created));
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "createEngagement" });
    log.error({ err }, "createEngagement failed");
    reply.code(500).send(Errors.internal());
  }
}

// ── Client side ────────────────────────────────────────────────────────────────

type ProfessionalSummary = {
  professionalId: string;
  displayName: string;
  professionalType: string;
  additionalTitle: string | null;
  verificationStatus: string;
};

type ClientEngagementDto = Omit<EngagementDto, "client"> & { professional: ProfessionalSummary };

type ClientEngagementRow = EngagementRow & {
  professional: {
    id: string;
    displayName: string;
    professionalType: string;
    additionalTitle: string | null;
    verificationStatus: string;
  };
};

function clientToDto(row: ClientEngagementRow): ClientEngagementDto {
  const base = toDto(row);
  // The client sees who the professional is, not their own client summary.
  const { client: _client, ...rest } = base;
  return {
    ...rest,
    professional: {
      professionalId: row.professional.id,
      displayName: row.professional.displayName,
      professionalType: row.professional.professionalType,
      additionalTitle: row.professional.additionalTitle,
      verificationStatus: row.professional.verificationStatus,
    },
  };
}

// Called from /auth/verify after the user is resolved (D26). Links any pending invite
// keyed by this phone to the now-known user. Idempotent; matches only unlinked pending
// rows. Returns how many were reconciled (for logging).
export async function reconcileEngagementInvites(userId: string, phone: string): Promise<number> {
  const res = await prisma.engagement.updateMany({
    where: { inviteePhone: phone, clientUserId: null, status: "pending" },
    data: { clientUserId: userId, inviteePhone: null },
  });
  return res.count;
}

// GET /engagements — the caller's engagements as a client (pending to accept, active,
// ended history), with the professional's profile.
export async function handleListClientEngagements(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "listClientEngagements" });
  const userId = request.userId!;
  try {
    const engagements = await prisma.engagement.findMany({
      where: { clientUserId: userId },
      orderBy: { createdAt: "desc" },
      include: { professional: true, clientUser: { include: { identities: true } } },
    });
    reply.code(200).send({ engagements: engagements.map((e) => clientToDto(e as ClientEngagementRow)) });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "listClientEngagements" });
    log.error({ err }, "listClientEngagements failed");
    reply.code(500).send(Errors.internal());
  }
}

// POST /engagements/:engagementId/accept — client consents; pending → active (D5).
// The universal consent gate: no client data flows until this happens.
export async function handleAcceptEngagement(
  request: FastifyRequest<{ Params: { engagementId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "acceptEngagement" });
  const userId = request.userId!;
  try {
    const { engagementId } = request.params;
    const eng = await prisma.engagement.findUnique({ where: { id: engagementId } });
    if (!eng || eng.clientUserId !== userId) {
      reply.code(404).send(Errors.notFound("Engagement not found."));
      return;
    }
    if (eng.status !== "pending") {
      reply.code(409).send(Errors.conflict("Engagement is not pending."));
      return;
    }
    try {
      const updated = await prisma.engagement.update({
        where: { id: engagementId },
        data: { status: "active", acceptedAt: new Date() },
        include: { professional: true, clientUser: { include: { identities: true } } },
      });
      log.info({ userId, engagementId }, "engagement accepted");
      reply.code(200).send(clientToDto(updated as ClientEngagementRow));
    } catch (e) {
      // Partial-unique (D24): an active engagement with this professional already exists.
      if ((e as { code?: string }).code === "P2002") {
        reply.code(409).send(Errors.conflict("You already have an active engagement with this professional."));
        return;
      }
      throw e;
    }
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "acceptEngagement" });
    log.error({ err }, "acceptEngagement failed");
    reply.code(500).send(Errors.internal());
  }
}

// POST /engagements/:engagementId/end — client ends the engagement (D11). Allowed from
// pending (decline) or active. Access is cut by derivation; no share rows touched.
export async function handleEndEngagementByClient(
  request: FastifyRequest<{ Params: { engagementId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "endEngagementByClient" });
  const userId = request.userId!;
  try {
    const { engagementId } = request.params;
    const eng = await prisma.engagement.findUnique({ where: { id: engagementId } });
    if (!eng || eng.clientUserId !== userId) {
      reply.code(404).send(Errors.notFound("Engagement not found."));
      return;
    }
    if (eng.status === "ended") {
      reply.code(409).send(Errors.conflict("Engagement has already ended."));
      return;
    }
    const updated = await prisma.engagement.update({
      where: { id: engagementId },
      data: { status: "ended", endedAt: new Date(), endedBy: "client" },
      include: { professional: true, clientUser: { include: { identities: true } } },
    });
    log.info({ userId, engagementId }, "engagement ended by client");
    reply.code(200).send(clientToDto(updated as ClientEngagementRow));
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "endEngagementByClient" });
    log.error({ err }, "endEngagementByClient failed");
    reply.code(500).send(Errors.internal());
  }
}

// POST /professional/engagements/:engagementId/end — professional ends it (D11).
export async function handleEndEngagementByPro(
  request: FastifyRequest<{ Params: { engagementId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "endEngagementByPro" });
  const userId = request.userId!;
  try {
    const { engagementId } = request.params;
    const eng = await prisma.engagement.findUnique({
      where: { id: engagementId },
      include: { professional: true },
    });
    if (!eng || eng.professional.userId !== userId) {
      reply.code(404).send(Errors.notFound("Engagement not found."));
      return;
    }
    if (eng.status === "ended") {
      reply.code(409).send(Errors.conflict("Engagement has already ended."));
      return;
    }
    const updated = await prisma.engagement.update({
      where: { id: engagementId },
      data: { status: "ended", endedAt: new Date(), endedBy: "professional" },
      include: { clientUser: { include: { identities: true } } },
    });
    log.info({ userId, engagementId }, "engagement ended by professional");
    reply.code(200).send(toDto(updated));
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "endEngagementByPro" });
    log.error({ err }, "endEngagementByPro failed");
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

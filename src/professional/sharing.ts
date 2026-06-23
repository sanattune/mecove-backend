import { prisma } from "../infra/prisma";

// Professional-support Insight sharing service. Shared by the REST handlers (client-driven
// share) and the worker (auto-send on SessionBridge completion) so the upsert rule
// lives in one place. Access is DERIVED at read time (active engagement + non-revoked
// share, D23) — these functions only manage the grant rows.

// Create or re-activate a share (D6/D12). Re-sharing a previously-revoked insight
// clears revokedAt rather than inserting a duplicate (respects the unique pair).
export async function shareInsightToEngagement(
  engagementId: string,
  insightId: string,
  autoSent = false
) {
  return prisma.insightShare.upsert({
    where: { engagementId_insightId: { engagementId, insightId } },
    update: { revokedAt: null, sharedAt: new Date(), ...(autoSent ? { autoSent: true } : {}) },
    create: { engagementId, insightId, autoSent },
  });
}

// Auto-send (D28): when a client's SessionBridge insight completes, push it to every
// active engagement that has the per-engagement toggle on. Returns the count shared.
export async function autoShareSessionBridgeInsight(insightId: string, userId: string): Promise<number> {
  const engagements = await prisma.engagement.findMany({
    where: { clientUserId: userId, status: "active", autoSendSessionBridge: true },
    select: { id: true },
  });
  for (const e of engagements) {
    await shareInsightToEngagement(e.id, insightId, true);
  }
  return engagements.length;
}

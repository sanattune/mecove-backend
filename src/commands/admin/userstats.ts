import { prisma } from "../../infra/prisma";
import { getConfigName } from "../../access/config";
import type { CommandContext, CommandResult } from "../types";

export async function handleUserStats(_ctx: CommandContext): Promise<CommandResult> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fifteenDaysAgo = new Date(todayStart.getTime() - 15 * 24 * 60 * 60 * 1000);

  const [identities, journalMessages, lastMessages] = await Promise.all([
    prisma.identity.findMany({
      where: { channel: "whatsapp", user: { approvedAt: { not: null } } },
      select: { channelUserKey: true, userId: true, displayName: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.message.findMany({
      where: { classifierType: "journal_entry", createdAt: { gte: fifteenDaysAgo } },
      select: { userId: true, createdAt: true },
    }),
    prisma.message.groupBy({
      by: ["userId"],
      _max: { createdAt: true },
      where: { category: { not: "test_feedback" } },
    }),
  ]);

  const activeDaySetMap = new Map<string, Set<number>>();
  for (const msg of journalMessages) {
    const day = new Date(msg.createdAt.getFullYear(), msg.createdAt.getMonth(), msg.createdAt.getDate()).getTime();
    if (!activeDaySetMap.has(msg.userId)) activeDaySetMap.set(msg.userId, new Set());
    activeDaySetMap.get(msg.userId)!.add(day);
  }

  const lastMsgMap = new Map(lastMessages.map((r) => [r.userId, r._max.createdAt]));

  const formatName = (ck: string, displayName: string | null) => {
    const name = displayName?.trim() || getConfigName(ck);
    return name ? `${name} (${ck})` : ck;
  };

  const formatLastSeen = (userId: string): string => {
    const last = lastMsgMap.get(userId) ?? null;
    if (!last) return "never";
    const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    const diffDays = Math.round((todayStart.getTime() - lastDay.getTime()) / 86400000);
    return diffDays === 0 ? "today" : diffDays === 1 ? "yesterday" : `${diffDays}d ago`;
  };

  const engaged: string[] = [];
  const lessEngaged: string[] = [];
  const disconnected: string[] = [];

  for (const { channelUserKey: ck, userId, displayName } of identities) {
    const activeDays = activeDaySetMap.get(userId)?.size ?? 0;
    const label = formatName(ck, displayName);

    if (activeDays >= 10) {
      engaged.push(`  ${label} — ${activeDays}/15 days`);
    } else if (activeDays >= 1) {
      lessEngaged.push(`  ${label} — ${activeDays}/15 days, last: ${formatLastSeen(userId)}`);
    } else {
      disconnected.push(`  ${label} — last: ${formatLastSeen(userId)}`);
    }
  }

  const sections: string[] = [`📊 *User Stats (${identities.length})*`];
  if (engaged.length > 0) sections.push(`\n\n🟢 *Engaged (${engaged.length})* — 10+ days/15\n${engaged.join("\n")}`);
  if (lessEngaged.length > 0) sections.push(`\n\n🟡 *Less Engaged (${lessEngaged.length})* — 1–9 days/15\n${lessEngaged.join("\n")}`);
  if (disconnected.length > 0) sections.push(`\n\n🔴 *Disconnected (${disconnected.length})* — no journal activity\n${disconnected.join("\n")}`);

  return { kind: "reply", text: sections.join("") };
}

import { prisma } from "../../infra/prisma";
import type { CommandContext, CommandResult } from "../types";

export async function handleStats({ userId }: CommandContext): Promise<CommandResult> {
  const [messageCount, firstMessage, lastSummary] = await Promise.all([
    prisma.message.count({ where: { userId, category: { not: "test_feedback" } } }),
    prisma.message.findFirst({
      where: { userId, category: { not: "test_feedback" } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.summary.findFirst({
      where: { userId, status: { in: ["success", "success_fallback"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const memberSince = firstMessage ? firstMessage.createdAt.toISOString().slice(0, 10) : null;
  const lastReport = lastSummary ? lastSummary.createdAt.toISOString().slice(0, 10) : "none";
  const sinceText = memberSince ? ` since ${memberSince}` : "";
  return {
    kind: "reply",
    text: `${messageCount} message${messageCount === 1 ? "" : "s"} logged${sinceText}.\nLast SessionBridge report: ${lastReport}.`,
  };
}

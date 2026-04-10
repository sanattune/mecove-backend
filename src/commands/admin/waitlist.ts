import { prisma } from "../../infra/prisma";
import type { CommandContext, CommandResult } from "../types";

export async function handleWaitlist(_ctx: CommandContext): Promise<CommandResult> {
  const waitlisted = await prisma.identity.findMany({
    where: { channel: "whatsapp", user: { approvedAt: null } },
    select: { channelUserKey: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (waitlisted.length === 0) return { kind: "reply", text: "No users on the waitlist." };
  const lines = waitlisted.map(
    (i) => `${i.channelUserKey} (since ${i.createdAt.toISOString().slice(0, 10)})`
  );
  return { kind: "reply", text: `Waitlist (${waitlisted.length}):\n${lines.join("\n")}` };
}

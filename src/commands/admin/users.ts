import { prisma } from "../../infra/prisma";
import { getConfigName } from "../../access/config";
import type { CommandContext, CommandResult } from "../types";

export async function handleUsers(_ctx: CommandContext): Promise<CommandResult> {
  const identities = await prisma.identity.findMany({
    where: { channel: "whatsapp", user: { approvedAt: { not: null } } },
    select: { channelUserKey: true, user: { select: { role: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (identities.length === 0) return { kind: "reply", text: "No approved users." };
  const lines = identities.map((i) => {
    const name = getConfigName(i.channelUserKey);
    const tag = i.user.role === "admin" ? " [admin]" : "";
    return name ? `${name} (${i.channelUserKey})${tag}` : `${i.channelUserKey}${tag}`;
  });
  return { kind: "reply", text: `Users (${identities.length}):\n${lines.join("\n")}` };
}

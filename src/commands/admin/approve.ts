import { prisma } from "../../infra/prisma";
import type { CommandContext, CommandResult } from "../types";

export async function handleApprove({ messageText }: CommandContext): Promise<CommandResult> {
  const phoneArg = messageText.trim().split(/\s+/)[1]?.trim() ?? "";
  const normalizedPhone = phoneArg.startsWith("+") ? phoneArg : `+${phoneArg}`;
  const targetIdentity = await prisma.identity.findUnique({
    where: { channel_channelUserKey: { channel: "whatsapp", channelUserKey: normalizedPhone } },
    include: { user: true },
  });
  if (!targetIdentity) return { kind: "reply", text: `No user found for ${normalizedPhone}.` };
  if (targetIdentity.user.approvedAt) return { kind: "reply", text: `${normalizedPhone} is already approved.` };
  await prisma.user.update({
    where: { id: targetIdentity.userId },
    data: { approvedAt: new Date() },
  });
  return { kind: "reply", text: `${normalizedPhone} approved.` };
}

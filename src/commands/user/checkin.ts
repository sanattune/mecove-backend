import { prisma } from "../../infra/prisma";
import { encryptText } from "../../infra/encryption";
import { getOrCreateUserDek } from "../../infra/userDek";
import { handleCheckinIntent } from "../../engagement/checkin/handler";
import type { CommandContext, CommandResult } from "../types";

export async function handleCheckin({ userId, messageId, channelUserKey }: CommandContext): Promise<CommandResult> {
  const checkinBodyText = await handleCheckinIntent({ userId, channelUserKey });
  const checkinDek = await getOrCreateUserDek(userId);
  await prisma.message.update({
    where: { id: messageId },
    data: {
      repliedAt: new Date(),
      replyText: encryptText(checkinBodyText, checkinDek),
    },
  });
  return { kind: "handled" };
}

import { prisma } from "../../infra/prisma";
import { getRedis } from "../../infra/redis";
import { clearReplyBatchState } from "../../replyBatch/state";
import { clearSummaryArtifactsForUser } from "../../summary/redisArtifacts";
import { summaryLockKey, summaryRangePromptKey } from "../../summary/keys";
import type { CommandContext, CommandResult } from "../types";

const CHAT_CLEARED_TEXT = "Your chat history has been cleared.";

export async function handleClear({ userId }: CommandContext): Promise<CommandResult> {
  await prisma.$transaction([
    prisma.summary.deleteMany({ where: { userId } }),
    prisma.message.deleteMany({ where: { userId } }),
  ]);
  await getRedis().del(summaryLockKey(userId), summaryRangePromptKey(userId));
  await clearReplyBatchState(userId);
  await clearSummaryArtifactsForUser(userId);
  return { kind: "reply_no_persist", text: CHAT_CLEARED_TEXT };
}

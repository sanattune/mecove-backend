import { prisma } from "../../infra/prisma";
import { getRedis } from "../../infra/redis";
import { clearReplyBatchState } from "../../replyBatch/state";
import { clearInsightArtifactsForUser } from "../../insight/redisArtifacts";
import {
  insightChosenTypeKey,
  insightLockKey,
  insightRangePromptKey,
  insightTypePromptKey,
} from "../../insight/keys";
import type { CommandContext, CommandResult } from "../types";

const CHAT_CLEARED_TEXT = "Your chat history has been cleared.";

export async function handleClear({ userId }: CommandContext): Promise<CommandResult> {
  await prisma.$transaction([
    prisma.insight.deleteMany({ where: { userId } }),
    prisma.message.deleteMany({ where: { userId } }),
  ]);
  await getRedis().del(
    insightLockKey(userId),
    insightRangePromptKey(userId),
    insightTypePromptKey(userId),
    insightChosenTypeKey(userId)
  );
  await clearReplyBatchState(userId);
  await clearInsightArtifactsForUser(userId);
  return { kind: "reply_no_persist", text: CHAT_CLEARED_TEXT };
}

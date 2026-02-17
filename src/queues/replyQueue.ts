import { Queue } from "bullmq";
import { getRedis } from "../infra/redis";

export const REPLY_QUEUE_NAME = "reply";
export const JOB_NAME_GENERATE_REPLY = "generateReply";

export type ReplyJobMode = "command" | "busy_notice";

export type GenerateReplyPayload = {
  userId: string;
  messageId: string;
  channelUserKey: string;
  messageText: string;
  mode: ReplyJobMode;
};

export const replyQueue = new Queue(REPLY_QUEUE_NAME, {
  connection: getRedis(),
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

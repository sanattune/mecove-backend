import { Queue } from "bullmq";
import { getRedis } from "../infra/redis";

export const REPLY_BATCH_QUEUE_NAME = "reply_batch";
export const JOB_NAME_FLUSH_REPLY_BATCH = "flushReplyBatch";

export type FlushReplyBatchPayload = {
  userId: string;
  seq: number;
};

export const replyBatchQueue = new Queue<FlushReplyBatchPayload>(REPLY_BATCH_QUEUE_NAME, {
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

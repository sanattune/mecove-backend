import { Queue } from "bullmq";
import { getRedis } from "../infra/redis";
import { startupDebugTime } from "../infra/startupDebug";
import type { InsightType } from "../insight/types";

export const INSIGHT_QUEUE_NAME = "insight";
export const JOB_NAME_GENERATE_INSIGHT = "generateInsight";

export type GenerateInsightPayload = {
  userId: string;
  channelUserKey: string;
  range: "last_7_days" | "last_15_days" | "last_30_days";
  insightType: InsightType;
  channel: "app" | "whatsapp";
  insightId?: string;
};

export const insightQueue = startupDebugTime(
  "queue:insight:create",
  () => new Queue(INSIGHT_QUEUE_NAME, {
    connection: getRedis(),
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
    },
  })
);

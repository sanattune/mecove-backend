import { Queue } from "bullmq";
import { getRedis } from "../infra/redis";

export const SUMMARY_QUEUE_NAME = "summary";
export const JOB_NAME_GENERATE_SUMMARY = "generateSummary";

export type GenerateSummaryPayload = {
  userId: string;
  range: "last_7_days";
};

export const summaryQueue = new Queue(SUMMARY_QUEUE_NAME, {
  connection: getRedis(),
  defaultJobOptions: { removeOnComplete: { count: 1000 } },
});

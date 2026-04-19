import { Queue } from "bullmq";
import { getRedis } from "../infra/redis";
import type { ReportType } from "../summary/types";

export const SUMMARY_QUEUE_NAME = "summary";
export const JOB_NAME_GENERATE_SUMMARY = "generateSummary";

export type GenerateSummaryPayload = {
  userId: string;
  channelUserKey: string;
  range: "last_7_days" | "last_15_days" | "last_30_days";
  reportType: ReportType;
};

export const summaryQueue = new Queue(SUMMARY_QUEUE_NAME, {
  connection: getRedis(),
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
  },
});

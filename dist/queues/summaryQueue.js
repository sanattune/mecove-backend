"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summaryQueue = exports.JOB_NAME_GENERATE_SUMMARY = exports.SUMMARY_QUEUE_NAME = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../infra/redis");
exports.SUMMARY_QUEUE_NAME = "summary";
exports.JOB_NAME_GENERATE_SUMMARY = "generateSummary";
exports.summaryQueue = new bullmq_1.Queue(exports.SUMMARY_QUEUE_NAME, {
    connection: (0, redis_1.getRedis)(),
    defaultJobOptions: {
        removeOnComplete: { count: 1000 },
    },
});

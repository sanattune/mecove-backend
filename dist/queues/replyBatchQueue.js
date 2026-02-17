"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replyBatchQueue = exports.JOB_NAME_FLUSH_REPLY_BATCH = exports.REPLY_BATCH_QUEUE_NAME = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../infra/redis");
exports.REPLY_BATCH_QUEUE_NAME = "reply_batch";
exports.JOB_NAME_FLUSH_REPLY_BATCH = "flushReplyBatch";
exports.replyBatchQueue = new bullmq_1.Queue(exports.REPLY_BATCH_QUEUE_NAME, {
    connection: (0, redis_1.getRedis)(),
    defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 2000,
        },
    },
});

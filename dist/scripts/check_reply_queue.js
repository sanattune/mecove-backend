"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const redis_1 = require("../infra/redis");
const replyQueue_1 = require("../queues/replyQueue");
async function main() {
    const redis = (0, redis_1.getRedis)();
    console.log("=== Reply Queue Diagnostics ===\n");
    // Check environment variables
    console.log("Environment Variables:");
    console.log("  WHATSAPP_PHONE_NUMBER_ID:", process.env.WHATSAPP_PHONE_NUMBER_ID ? "✅ Set" : "❌ Missing");
    console.log("  WHATSAPP_PERMANENT_TOKEN:", process.env.WHATSAPP_PERMANENT_TOKEN ? "✅ Set" : "❌ Missing");
    console.log("  GROQ_API_KEY:", process.env.GROQ_API_KEY ? "✅ Set" : "❌ Missing");
    console.log();
    // Check queue status
    const waiting = await redis.llen(`${replyQueue_1.REPLY_QUEUE_NAME}:wait`);
    const active = await redis.llen(`${replyQueue_1.REPLY_QUEUE_NAME}:active`);
    const completed = await redis.zcard(`${replyQueue_1.REPLY_QUEUE_NAME}:completed`);
    const failed = await redis.zcard(`${replyQueue_1.REPLY_QUEUE_NAME}:failed`);
    console.log("Queue Status:");
    console.log(`  Waiting: ${waiting}`);
    console.log(`  Active: ${active}`);
    console.log(`  Completed: ${completed}`);
    console.log(`  Failed: ${failed}`);
    console.log();
    // Check for failed jobs
    if (failed > 0) {
        console.log("⚠️  Failed jobs found! Check worker logs for details.");
        const failedJobs = await redis.zrange(`${replyQueue_1.REPLY_QUEUE_NAME}:failed`, 0, 4, "WITHSCORES");
        console.log("  Recent failed jobs:", failedJobs);
    }
    // Check Redis connection
    try {
        await redis.ping();
        console.log("Redis: ✅ Connected");
    }
    catch (err) {
        console.log("Redis: ❌ Connection failed", err);
    }
    await redis.quit();
}
main().catch(console.error);

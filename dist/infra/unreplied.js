"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addUnrepliedMessage = addUnrepliedMessage;
exports.removeUnrepliedMessage = removeUnrepliedMessage;
exports.hasUnrepliedMessages = hasUnrepliedMessages;
exports.hasOtherUnrepliedMessages = hasOtherUnrepliedMessages;
exports.getUnrepliedDebugInfo = getUnrepliedDebugInfo;
exports.getUnrepliedCount = getUnrepliedCount;
const redis_1 = require("./redis");
const logger_1 = require("./logger");
const EXPIRY_MS = 60000; // 1 minute
/**
 * Tracks unreplied messages using Redis ZSET (sorted set).
 * Score = timestamp, value = messageId
 * Messages expire after 1 minute automatically.
 */
/**
 * Add a message to the unreplied tracking set.
 * Called when a new message arrives.
 */
async function addUnrepliedMessage(userId, messageId) {
    const redis = (0, redis_1.getRedis)();
    const timestamp = Date.now();
    const key = `unreplied:${userId}`;
    await redis.zadd(key, timestamp, messageId);
    const count = await redis.zcard(key);
    logger_1.logger.info("added to unreplied tracking", { userId, messageId, totalCount: count });
}
/**
 * Remove a message from the unreplied tracking set.
 * Called when a reply is sent.
 */
async function removeUnrepliedMessage(userId, messageId) {
    const redis = (0, redis_1.getRedis)();
    const key = `unreplied:${userId}`;
    await redis.zrem(key, messageId);
    const count = await redis.zcard(key);
    logger_1.logger.info("removed from unreplied tracking", { userId, messageId, remainingCount: count });
}
/**
 * Check if there are any unreplied messages for a user.
 * Also removes expired entries (> 1 minute old).
 * Returns true if there are any unreplied messages.
 */
async function hasUnrepliedMessages(userId) {
    const redis = (0, redis_1.getRedis)();
    const now = Date.now();
    const expiryThreshold = now - EXPIRY_MS;
    // Remove expired entries (older than 1 minute)
    await redis.zremrangebyscore(`unreplied:${userId}`, 0, expiryThreshold);
    // Check if any unreplied messages remain
    const count = await redis.zcard(`unreplied:${userId}`);
    return count > 0;
}
/**
 * Check if there are any OTHER unreplied messages (excluding the current message).
 * Used to determine if a reply should be contextual.
 * Also removes expired entries (> 1 minute old).
 */
async function hasOtherUnrepliedMessages(userId, excludeMessageId) {
    const redis = (0, redis_1.getRedis)();
    const now = Date.now();
    const expiryThreshold = now - EXPIRY_MS;
    const key = `unreplied:${userId}`;
    // Remove expired entries (older than 1 minute)
    await redis.zremrangebyscore(key, 0, expiryThreshold);
    // Get all message IDs in the set
    const allMessageIds = await redis.zrange(key, 0, -1);
    const totalCount = allMessageIds.length;
    // Filter out the current message
    const otherMessageIds = allMessageIds.filter(id => id !== excludeMessageId);
    const otherCount = otherMessageIds.length;
    return otherCount > 0;
}
/**
 * Get debug info about unreplied messages (for logging).
 */
async function getUnrepliedDebugInfo(userId, excludeMessageId) {
    const redis = (0, redis_1.getRedis)();
    const now = Date.now();
    const expiryThreshold = now - EXPIRY_MS;
    const key = `unreplied:${userId}`;
    // Remove expired entries
    await redis.zremrangebyscore(key, 0, expiryThreshold);
    // Get all message IDs
    const allMessageIds = await redis.zrange(key, 0, -1);
    const othersIds = excludeMessageId
        ? allMessageIds.filter(id => id !== excludeMessageId)
        : allMessageIds;
    return {
        total: allMessageIds.length,
        others: othersIds.length,
        allIds: allMessageIds,
        othersIds,
    };
}
/**
 * Get count of unreplied messages (after cleanup).
 * Useful for debugging/monitoring.
 */
async function getUnrepliedCount(userId) {
    const redis = (0, redis_1.getRedis)();
    const now = Date.now();
    const expiryThreshold = now - EXPIRY_MS;
    // Remove expired entries
    await redis.zremrangebyscore(`unreplied:${userId}`, 0, expiryThreshold);
    // Return count
    return redis.zcard(`unreplied:${userId}`);
}

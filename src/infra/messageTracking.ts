import { getRedis } from "./redis";
import { logger } from "./logger";

const EXPIRY_MS = 60000; // 1 minute

/**
 * Tracks messages using Redis ZSET (sorted set) with timestamps.
 * Score = timestamp, value = messageId
 * Used to quickly count messages that came after a given message.
 */

/**
 * Add a message to the tracking set with its timestamp.
 * Called when a new message arrives.
 */
export async function addMessageTracking(
  userId: string,
  messageId: string,
  timestamp: number
): Promise<void> {
  const redis = getRedis();
  const key = `messages:${userId}`;
  await redis.zadd(key, timestamp, messageId);
  
  // Clean up old entries (older than 1 minute)
  const now = Date.now();
  const expiryThreshold = now - EXPIRY_MS;
  await redis.zremrangebyscore(key, 0, expiryThreshold);
  
  // Silent - no log needed for normal operation
}

/**
 * Count how many messages came after the given message.
 * Returns the count of messages with timestamp > given message timestamp.
 */
export async function countMessagesAfter(
  userId: string,
  messageTimestamp: number
): Promise<number> {
  const redis = getRedis();
  const key = `messages:${userId}`;
  
  // Clean up old entries first
  const now = Date.now();
  const expiryThreshold = now - EXPIRY_MS;
  await redis.zremrangebyscore(key, 0, expiryThreshold);
  
  // Count messages with timestamp > messageTimestamp
  // Using (messageTimestamp + 1) to exclude the current message itself
  const count = await redis.zcount(key, messageTimestamp + 1, "+inf");
  
  return count;
}

/**
 * Remove a message from tracking (optional cleanup).
 * Messages will auto-expire after 1 minute anyway.
 */
export async function removeMessageTracking(
  userId: string,
  messageId: string
): Promise<void> {
  const redis = getRedis();
  const key = `messages:${userId}`;
  await redis.zrem(key, messageId);
  // Silent - no log needed for normal operation
}

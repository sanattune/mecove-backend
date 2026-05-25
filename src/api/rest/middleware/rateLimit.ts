import { getRedis } from "../../../infra/redis";

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= limit;
}

export const RateLimits = {
  requestOtp: (phone: string) => ({
    key: `rl:request-otp:${phone}`,
    limit: 100,
    windowSeconds: 15 * 60,
  }),
  verifyOtp: (phone: string) => ({
    key: `rl:verify-otp:${phone}`,
    limit: 10,
    windowSeconds: 15 * 60,
  }),
  sendMessage: (userId: string) => ({
    key: `rl:send-message:${userId}`,
    limit: 20,
    windowSeconds: 60,
  }),
};

import Redis from "ioredis";
import { startupDebug, startupDebugTime } from "./startupDebug";

let connection: Redis | null = null;

/**
 * Returns a shared ioredis connection using REDIS_URL.
 * Fails fast if REDIS_URL is missing.
 */
export function getRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url || url === "") {
    throw new Error("REDIS_URL is required. Set it in .env");
  }
  if (!connection) {
    connection = startupDebugTime("redis:create-client", () => new Redis(url, { maxRetriesPerRequest: null }));
    startupDebug("redis:client-created");
  }
  return connection;
}

export async function closeRedis(): Promise<void> {
  if (!connection) return;
  const redis = connection;
  connection = null;
  await redis.quit();
}

import Redis from "ioredis";

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
    connection = new Redis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}

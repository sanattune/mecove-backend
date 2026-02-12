import { getRedis } from "../infra/redis";

const ARTIFACT_TTL_SECONDS = 24 * 60 * 60;

function stageKey(summaryId: string, stage: string): string {
  return `summary:artifact:${summaryId}:${stage}`;
}

function userIndexKey(userId: string): string {
  return `summary:artifact:index:${userId}`;
}

export async function writeSummaryArtifact(
  userId: string,
  summaryId: string,
  stage: string,
  payload: unknown,
  ttlSeconds = ARTIFACT_TTL_SECONDS
): Promise<void> {
  const redis = getRedis();
  const key = stageKey(summaryId, stage);
  const value = JSON.stringify({
    userId,
    summaryId,
    stage,
    createdAt: new Date().toISOString(),
    payload,
  });

  const indexKey = userIndexKey(userId);
  await redis.multi().set(key, value, "EX", ttlSeconds).sadd(indexKey, summaryId).expire(indexKey, ttlSeconds).exec();
}

export async function writeSummaryErrorArtifact(
  userId: string,
  summaryId: string,
  stage: string,
  error: string,
  rawSnippet?: string
): Promise<void> {
  await writeSummaryArtifact(userId, summaryId, `error_${stage}`, {
    error,
    rawSnippet: rawSnippet ?? "",
  });
}

async function listKeysForSummary(summaryId: string): Promise<string[]> {
  const redis = getRedis();
  const pattern = stageKey(summaryId, "*");
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, found] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;
    keys.push(...found);
  } while (cursor !== "0");
  return keys;
}

export async function clearSummaryArtifactsForUser(userId: string): Promise<void> {
  const redis = getRedis();
  const indexKey = userIndexKey(userId);
  const summaryIds = await redis.smembers(indexKey);
  if (summaryIds.length === 0) {
    await redis.del(indexKey);
    return;
  }

  const keysToDelete: string[] = [];
  for (const summaryId of summaryIds) {
    const keys = await listKeysForSummary(summaryId);
    keysToDelete.push(...keys);
  }

  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
  }
  await redis.del(indexKey);
}


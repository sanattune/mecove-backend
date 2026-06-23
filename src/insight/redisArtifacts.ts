import { getRedis } from "../infra/redis";

const ARTIFACT_TTL_SECONDS = 24 * 60 * 60;

function stageKey(insightId: string, stage: string): string {
  return `insight:artifact:${insightId}:${stage}`;
}

function userIndexKey(userId: string): string {
  return `insight:artifact:index:${userId}`;
}

export async function writeInsightArtifact(
  userId: string,
  insightId: string,
  stage: string,
  payload: unknown,
  ttlSeconds = ARTIFACT_TTL_SECONDS
): Promise<void> {
  const redis = getRedis();
  const key = stageKey(insightId, stage);
  const value = JSON.stringify({
    userId,
    insightId,
    stage,
    createdAt: new Date().toISOString(),
    payload,
  });

  const indexKey = userIndexKey(userId);
  await redis.multi().set(key, value, "EX", ttlSeconds).sadd(indexKey, insightId).expire(indexKey, ttlSeconds).exec();
}

export async function writeInsightErrorArtifact(
  userId: string,
  insightId: string,
  stage: string,
  error: string,
  rawSnippet?: string
): Promise<void> {
  await writeInsightArtifact(userId, insightId, `error_${stage}`, {
    error,
    rawSnippet: rawSnippet ?? "",
  });
}

async function listKeysForInsight(insightId: string): Promise<string[]> {
  const redis = getRedis();
  const pattern = stageKey(insightId, "*");
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, found] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;
    keys.push(...found);
  } while (cursor !== "0");
  return keys;
}

export async function clearInsightArtifactsForUser(userId: string): Promise<void> {
  const redis = getRedis();
  const indexKey = userIndexKey(userId);
  const insightIds = await redis.smembers(indexKey);
  if (insightIds.length === 0) {
    await redis.del(indexKey);
    return;
  }

  const keysToDelete: string[] = [];
  for (const insightId of insightIds) {
    const keys = await listKeysForInsight(insightId);
    keysToDelete.push(...keys);
  }

  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
  }
  await redis.del(indexKey);
}

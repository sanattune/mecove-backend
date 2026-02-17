import { randomUUID } from "node:crypto";
import { getRedis } from "../infra/redis";

const BATCH_STATE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_LOCK_TTL_SECONDS = 30;

type ReplyBatchKeys = {
  metaKey: string;
  idsKey: string;
  lockKey: string;
};

function batchKeys(userId: string): ReplyBatchKeys {
  return {
    metaKey: `reply:batch:${userId}:meta`,
    idsKey: `reply:batch:${userId}:ids`,
    lockKey: `reply:batch:${userId}:lock`,
  };
}

function toInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.floor(value);
}

function toMetaObject(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < pairs.length - 1; i += 2) {
    result[pairs[i]] = pairs[i + 1];
  }
  return result;
}

export type ReplyBatchTiming = {
  startAtMs: number;
  lastAtMs: number;
  seq: number;
};

export type ReplyBatchMeta = ReplyBatchTiming & {
  channelUserKey: string;
  latestMessageId: string;
  latestSourceMessageId: string;
};

export type ClaimedReplyBatch = {
  ids: string[];
  meta: ReplyBatchMeta;
};

function parseBatchMeta(meta: Record<string, string>): ReplyBatchMeta | null {
  const startAtMs = toInt(meta.startAtMs);
  const lastAtMs = toInt(meta.lastAtMs);
  const seq = toInt(meta.seq);
  const channelUserKey = meta.channelUserKey ?? "";
  const latestMessageId = meta.latestMessageId ?? "";
  const latestSourceMessageId = meta.latestSourceMessageId ?? "";
  if (
    startAtMs === null ||
    lastAtMs === null ||
    seq === null ||
    !channelUserKey ||
    !latestMessageId ||
    !latestSourceMessageId
  ) {
    return null;
  }
  return {
    startAtMs,
    lastAtMs,
    seq,
    channelUserKey,
    latestMessageId,
    latestSourceMessageId,
  };
}

export async function appendMessageToBatch(input: {
  userId: string;
  messageId: string;
  channelUserKey: string;
  sourceMessageId: string;
  nowMs?: number;
}): Promise<{ seq: number }> {
  const redis = getRedis();
  const nowMs = input.nowMs ?? Date.now();
  const { metaKey, idsKey } = batchKeys(input.userId);

  const seq = await redis.hincrby(metaKey, "seq", 1);
  await redis
    .multi()
    .hsetnx(metaKey, "startAtMs", String(nowMs))
    .hset(
      metaKey,
      "lastAtMs",
      String(nowMs),
      "channelUserKey",
      input.channelUserKey,
      "latestMessageId",
      input.messageId,
      "latestSourceMessageId",
      input.sourceMessageId
    )
    .rpush(idsKey, input.messageId)
    .pexpire(metaKey, BATCH_STATE_TTL_MS)
    .pexpire(idsKey, BATCH_STATE_TTL_MS)
    .exec();

  return { seq: Number(seq) };
}

export async function hasPendingBatch(userId: string): Promise<boolean> {
  const redis = getRedis();
  const { idsKey } = batchKeys(userId);
  const count = await redis.llen(idsKey);
  return count > 0;
}

export async function getBatchTiming(userId: string): Promise<ReplyBatchTiming | null> {
  const redis = getRedis();
  const { metaKey, idsKey } = batchKeys(userId);
  const idCount = await redis.llen(idsKey);
  if (idCount <= 0) return null;

  const rawMeta = await redis.hgetall(metaKey);
  const meta = parseBatchMeta(rawMeta);
  if (!meta) return null;
  return {
    startAtMs: meta.startAtMs,
    lastAtMs: meta.lastAtMs,
    seq: meta.seq,
  };
}

const CLAIM_BATCH_SCRIPT = `
local ids = redis.call("LRANGE", KEYS[2], 0, -1)
if #ids == 0 then
  return nil
end
local meta = redis.call("HGETALL", KEYS[1])
redis.call("DEL", KEYS[1], KEYS[2])
return { ids, meta }
`;

export async function claimBatchAtomically(userId: string): Promise<ClaimedReplyBatch | null> {
  const redis = getRedis();
  const { metaKey, idsKey } = batchKeys(userId);
  const raw = (await redis.eval(CLAIM_BATCH_SCRIPT, 2, metaKey, idsKey)) as
    | [string[], string[]]
    | null;

  if (!raw || !Array.isArray(raw) || raw.length < 2) {
    return null;
  }

  const ids = Array.isArray(raw[0]) ? raw[0].map(String) : [];
  const metaPairs = Array.isArray(raw[1]) ? raw[1].map(String) : [];
  if (ids.length === 0 || metaPairs.length === 0) return null;

  const meta = parseBatchMeta(toMetaObject(metaPairs));
  if (!meta) return null;

  return { ids, meta };
}

export async function acquireReplyBatchFlushLock(
  userId: string,
  ttlSeconds = DEFAULT_LOCK_TTL_SECONDS
): Promise<string | null> {
  const redis = getRedis();
  const { lockKey } = batchKeys(userId);
  const token = randomUUID();
  const acquired = await redis.set(lockKey, token, "EX", ttlSeconds, "NX");
  return acquired ? token : null;
}

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export async function releaseReplyBatchFlushLock(
  userId: string,
  token: string
): Promise<void> {
  const redis = getRedis();
  const { lockKey } = batchKeys(userId);
  await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
}

export async function clearReplyBatchState(userId: string): Promise<void> {
  const redis = getRedis();
  const { metaKey, idsKey, lockKey } = batchKeys(userId);
  await redis.del(metaKey, idsKey, lockKey);
}

const RESTORE_BATCH_SCRIPT = `
local existingMeta = redis.call("HGETALL", KEYS[1])
local existingIds = redis.call("LRANGE", KEYS[2], 0, -1)

local startAtMs = tonumber(ARGV[1])
local lastAtMs = tonumber(ARGV[2])
local channelUserKey = ARGV[3]
local latestMessageId = ARGV[4]
local latestSourceMessageId = ARGV[5]
local seq = tonumber(ARGV[6])
local restoredCount = tonumber(ARGV[7])
local ttlMs = tonumber(ARGV[8])

if #existingMeta > 0 then
  local metaMap = {}
  for i = 1, #existingMeta, 2 do
    metaMap[existingMeta[i]] = existingMeta[i + 1]
  end

  local existingStart = tonumber(metaMap["startAtMs"])
  if existingStart and existingStart < startAtMs then
    startAtMs = existingStart
  end

  local existingLast = tonumber(metaMap["lastAtMs"])
  if existingLast and existingLast > lastAtMs then
    lastAtMs = existingLast
    channelUserKey = metaMap["channelUserKey"] or channelUserKey
    latestMessageId = metaMap["latestMessageId"] or latestMessageId
    latestSourceMessageId = metaMap["latestSourceMessageId"] or latestSourceMessageId
  end

  local existingSeq = tonumber(metaMap["seq"])
  if existingSeq and existingSeq > seq then
    seq = existingSeq
  end
end

redis.call("DEL", KEYS[2])
for i = 1, restoredCount do
  redis.call("RPUSH", KEYS[2], ARGV[8 + i])
end
for i = 1, #existingIds do
  redis.call("RPUSH", KEYS[2], existingIds[i])
end

redis.call(
  "HSET",
  KEYS[1],
  "startAtMs",
  tostring(startAtMs),
  "lastAtMs",
  tostring(lastAtMs),
  "channelUserKey",
  channelUserKey,
  "latestMessageId",
  latestMessageId,
  "latestSourceMessageId",
  latestSourceMessageId,
  "seq",
  tostring(seq)
)
redis.call("PEXPIRE", KEYS[1], ttlMs)
redis.call("PEXPIRE", KEYS[2], ttlMs)
return 1
`;

export async function restoreClaimedBatch(
  userId: string,
  claimedBatch: ClaimedReplyBatch
): Promise<void> {
  if (claimedBatch.ids.length === 0) return;
  const redis = getRedis();
  const { metaKey, idsKey } = batchKeys(userId);
  const argv: string[] = [
    String(claimedBatch.meta.startAtMs),
    String(claimedBatch.meta.lastAtMs),
    claimedBatch.meta.channelUserKey,
    claimedBatch.meta.latestMessageId,
    claimedBatch.meta.latestSourceMessageId,
    String(claimedBatch.meta.seq),
    String(claimedBatch.ids.length),
    String(BATCH_STATE_TTL_MS),
    ...claimedBatch.ids,
  ];
  await redis.eval(RESTORE_BATCH_SCRIPT, 2, metaKey, idsKey, ...argv);
}

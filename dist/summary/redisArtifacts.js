"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeSummaryArtifact = writeSummaryArtifact;
exports.writeSummaryErrorArtifact = writeSummaryErrorArtifact;
exports.clearSummaryArtifactsForUser = clearSummaryArtifactsForUser;
const redis_1 = require("../infra/redis");
const ARTIFACT_TTL_SECONDS = 24 * 60 * 60;
function stageKey(summaryId, stage) {
    return `summary:artifact:${summaryId}:${stage}`;
}
function userIndexKey(userId) {
    return `summary:artifact:index:${userId}`;
}
async function writeSummaryArtifact(userId, summaryId, stage, payload, ttlSeconds = ARTIFACT_TTL_SECONDS) {
    const redis = (0, redis_1.getRedis)();
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
async function writeSummaryErrorArtifact(userId, summaryId, stage, error, rawSnippet) {
    await writeSummaryArtifact(userId, summaryId, `error_${stage}`, {
        error,
        rawSnippet: rawSnippet ?? "",
    });
}
async function listKeysForSummary(summaryId) {
    const redis = (0, redis_1.getRedis)();
    const pattern = stageKey(summaryId, "*");
    const keys = [];
    let cursor = "0";
    do {
        const [nextCursor, found] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        keys.push(...found);
    } while (cursor !== "0");
    return keys;
}
async function clearSummaryArtifactsForUser(userId) {
    const redis = (0, redis_1.getRedis)();
    const indexKey = userIndexKey(userId);
    const summaryIds = await redis.smembers(indexKey);
    if (summaryIds.length === 0) {
        await redis.del(indexKey);
        return;
    }
    const keysToDelete = [];
    for (const summaryId of summaryIds) {
        const keys = await listKeysForSummary(summaryId);
        keysToDelete.push(...keys);
    }
    if (keysToDelete.length > 0) {
        await redis.del(...keysToDelete);
    }
    await redis.del(indexKey);
}

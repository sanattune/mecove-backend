"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WHATSAPP_TYPING_INDICATOR_ENABLED = exports.REPLY_BATCH_MAX_WAIT_MS = exports.REPLY_BATCH_DEBOUNCE_MS = void 0;
const logger_1 = require("../infra/logger");
const DEFAULT_REPLY_BATCH_DEBOUNCE_MS = 60_000;
const DEFAULT_REPLY_BATCH_MAX_WAIT_MS = 60_000;
function readPositiveIntMs(envKey, fallback) {
    const raw = process.env[envKey]?.trim();
    if (!raw)
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) {
        logger_1.logger.warn(`invalid ${envKey}, using default`, { raw, fallback });
        return fallback;
    }
    return Math.floor(parsed);
}
function readBoolean(envKey, fallback = false) {
    const raw = process.env[envKey]?.trim().toLowerCase();
    if (!raw)
        return fallback;
    if (raw === "1" || raw === "true" || raw === "yes")
        return true;
    if (raw === "0" || raw === "false" || raw === "no")
        return false;
    logger_1.logger.warn(`invalid ${envKey}, using default`, { raw, fallback });
    return fallback;
}
exports.REPLY_BATCH_DEBOUNCE_MS = readPositiveIntMs("REPLY_BATCH_DEBOUNCE_MS", DEFAULT_REPLY_BATCH_DEBOUNCE_MS);
const configuredMaxWaitMs = readPositiveIntMs("REPLY_BATCH_MAX_WAIT_MS", DEFAULT_REPLY_BATCH_MAX_WAIT_MS);
exports.REPLY_BATCH_MAX_WAIT_MS = configuredMaxWaitMs < exports.REPLY_BATCH_DEBOUNCE_MS
    ? exports.REPLY_BATCH_DEBOUNCE_MS
    : configuredMaxWaitMs;
if (configuredMaxWaitMs < exports.REPLY_BATCH_DEBOUNCE_MS) {
    logger_1.logger.warn("REPLY_BATCH_MAX_WAIT_MS is below debounce; clamped to debounce", {
        debounceMs: exports.REPLY_BATCH_DEBOUNCE_MS,
        configuredMaxWaitMs,
    });
}
exports.WHATSAPP_TYPING_INDICATOR_ENABLED = readBoolean("WHATSAPP_TYPING_INDICATOR_ENABLED", false);

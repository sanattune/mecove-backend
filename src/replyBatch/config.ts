import { logger } from "../infra/logger";

const DEFAULT_REPLY_BATCH_DEBOUNCE_MS = 60_000;
const DEFAULT_REPLY_BATCH_MAX_WAIT_MS = 60_000;

function readPositiveIntMs(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn(`invalid ${envKey}, using default`, { raw, fallback });
    return fallback;
  }
  return Math.floor(parsed);
}

function readBoolean(envKey: string, fallback = false): boolean {
  const raw = process.env[envKey]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  logger.warn(`invalid ${envKey}, using default`, { raw, fallback });
  return fallback;
}

export const REPLY_BATCH_DEBOUNCE_MS = readPositiveIntMs(
  "REPLY_BATCH_DEBOUNCE_MS",
  DEFAULT_REPLY_BATCH_DEBOUNCE_MS
);

const configuredMaxWaitMs = readPositiveIntMs(
  "REPLY_BATCH_MAX_WAIT_MS",
  DEFAULT_REPLY_BATCH_MAX_WAIT_MS
);

export const REPLY_BATCH_MAX_WAIT_MS =
  configuredMaxWaitMs < REPLY_BATCH_DEBOUNCE_MS
    ? REPLY_BATCH_DEBOUNCE_MS
    : configuredMaxWaitMs;

if (configuredMaxWaitMs < REPLY_BATCH_DEBOUNCE_MS) {
  logger.warn("REPLY_BATCH_MAX_WAIT_MS is below debounce; clamped to debounce", {
    debounceMs: REPLY_BATCH_DEBOUNCE_MS,
    configuredMaxWaitMs,
  });
}

export const WHATSAPP_TYPING_INDICATOR_ENABLED = readBoolean(
  "WHATSAPP_TYPING_INDICATOR_ENABLED",
  false
);

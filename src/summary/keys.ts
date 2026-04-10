const SUMMARY_RANGE_PROMPT_KEY_VERSION = "v1";

export function summaryLockKey(userId: string): string {
  return `summary:inflight:${userId}`;
}

export function summaryRangePromptKey(userId: string): string {
  return `summary:range_prompt:${SUMMARY_RANGE_PROMPT_KEY_VERSION}:${userId}`;
}

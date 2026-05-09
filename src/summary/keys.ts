const SUMMARY_RANGE_PROMPT_KEY_VERSION = "v1";
const SUMMARY_TYPE_PROMPT_KEY_VERSION = "v1";
const SUMMARY_CHOSEN_TYPE_KEY_VERSION = "v1";

export function summaryLockKey(userId: string): string {
  return `summary:inflight:${userId}`;
}

export function summaryRangePromptKey(userId: string): string {
  return `summary:range_prompt:${SUMMARY_RANGE_PROMPT_KEY_VERSION}:${userId}`;
}

export function summaryTypePromptKey(userId: string): string {
  return `summary:type_prompt:${SUMMARY_TYPE_PROMPT_KEY_VERSION}:${userId}`;
}

export function summaryChosenTypeKey(userId: string): string {
  return `summary:chosen_type:${SUMMARY_CHOSEN_TYPE_KEY_VERSION}:${userId}`;
}

const INSIGHT_RANGE_PROMPT_KEY_VERSION = "v1";
const INSIGHT_TYPE_PROMPT_KEY_VERSION = "v1";
const INSIGHT_CHOSEN_TYPE_KEY_VERSION = "v1";

export function insightLockKey(userId: string): string {
  return `insight:inflight:${userId}`;
}

export function insightRangePromptKey(userId: string): string {
  return `insight:range_prompt:${INSIGHT_RANGE_PROMPT_KEY_VERSION}:${userId}`;
}

export function insightTypePromptKey(userId: string): string {
  return `insight:type_prompt:${INSIGHT_TYPE_PROMPT_KEY_VERSION}:${userId}`;
}

export function insightChosenTypeKey(userId: string): string {
  return `insight:chosen_type:${INSIGHT_CHOSEN_TYPE_KEY_VERSION}:${userId}`;
}

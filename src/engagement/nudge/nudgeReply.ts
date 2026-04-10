import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { logger } from "../../infra/logger";
import { LlmViaApi } from "../../llm/llmViaApi";
import { fetchFormattedMessageLines } from "../../llm/context/messageContext";

const llm = new LlmViaApi();

type NudgeConfig = { messages: string[] };

const config = parse(
  readFileSync(join(__dirname, "nudge.yaml"), "utf8")
) as NudgeConfig;

function pickFallbackMessage(): string {
  const msgs = config.messages;
  return msgs[Math.floor(Math.random() * msgs.length)];
}

const NUDGE_PROMPT = `You are meCove, a WhatsApp-based listening space. The user hasn't written anything in a few days and you are proactively checking in.

Below is their recent message history. Find something unresolved, forward-looking, or emotionally significant and weave it into a warm, natural check-in message. Think: an open thread worth asking about — an upcoming event, an unresolved worry, a goal they mentioned.

Rules:
- 1-2 sentences maximum.
- Be warm and natural, like a friend checking in after a few days.
- No emojis.
- Do not summarize their history — pick ONE thread and ask about it naturally.
- If nothing stands out as worth following up on, just write a simple warm check-in.
- Reply in the user's language when it is clearly not English; otherwise reply in English.
- Output ONLY the message text. No JSON, no markdown, no commentary.

RECENT_MESSAGES:
{{RECENT_MESSAGES}}

Your check-in message:`;

const CONTEXT_FETCH_LIMIT = 30;
const CONTEXT_TARGET_COUNT = 15;

/**
 * Generate a nudge message for an inactive user.
 * Uses LLM to reference an open thread from recent history when available.
 * Falls back to a YAML template if no history or LLM fails.
 */
export async function generateNudgeMessage(userId: string): Promise<string> {
  const { lines } = await fetchFormattedMessageLines(userId, {
    fetchLimit: CONTEXT_FETCH_LIMIT,
    targetCount: CONTEXT_TARGET_COUNT,
    botLabel: "meCove",
  });

  if (lines.length === 0) {
    return pickFallbackMessage();
  }

  try {
    const prompt = NUDGE_PROMPT
      .split("{{RECENT_MESSAGES}}")
      .join(lines.join("\n"));

    const raw = await llm.complete({
      prompt,
      maxTokens: 100,
      complexity: "low",
      reasoning: false,
    });

    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("```")) {
      logger.warn("nudge LLM returned malformed output, using fallback", { userId });
      return pickFallbackMessage();
    }

    return trimmed;
  } catch (err) {
    logger.warn("nudge LLM call failed, using fallback", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return pickFallbackMessage();
  }
}

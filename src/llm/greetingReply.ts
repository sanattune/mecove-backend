import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { decryptText } from "../infra/encryption";
import { getOrCreateUserDek } from "../infra/userDek";
import { LlmViaApi } from "./llmViaApi";

const llm = new LlmViaApi();

// ── Time thresholds ──────────────────────────────────────────────────────────

const GAP_PERSONALIZED_MS = 5 * 60 * 60 * 1000; // 5 hours
const GAP_STALE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// ── Tier 3: "it's been a while" templates ────────────────────────────────────

const WELCOME_BACK_TEMPLATES = [
  "Hey, it's been a while! What's on your mind?",
  "Hi there, good to see you again. What's going on?",
  "Hey, been a few days. How are things?",
  "Hi, it's been a bit. How's everything going?",
  "Hey, welcome back. What's on your mind today?",
];

// ── Tier 2: personalized greeting prompt ─────────────────────────────────────

const GREETING_PROMPT = `You are meCove, a WhatsApp-based listening space. The user just greeted you after being away for a while. Below is their recent message history.

Your job: find something unresolved, forward-looking, or emotionally significant from the recent messages and weave it into a warm, natural greeting. Think: an open thread worth asking about — an upcoming event, an unresolved worry, a goal they mentioned.

Rules:
- 1-2 sentences maximum.
- Be warm and natural, like a friend checking in.
- No emojis.
- Do not summarize their history — pick ONE thread and ask about it naturally.
- If nothing stands out as worth following up on, just reply with a simple warm greeting.
- Reply in the user's language when it is clearly not English; otherwise reply in English.
- Output ONLY the greeting text. No JSON, no markdown, no commentary.

RECENT_MESSAGES:
{{RECENT_MESSAGES}}

USER_GREETING:
{{USER_GREETING}}

Your greeting:`;

const CONTEXT_FETCH_LIMIT = 30; // fetch buffer (pre-filter)
const CONTEXT_TARGET_COUNT = 15; // messages to include in prompt

/**
 * Generate a personalized greeting based on how long the user has been away.
 *
 * Returns the greeting text, or `null` if the gap is too short (< 5h)
 * and the caller should use the classifier's simple reply instead.
 */
export async function generateGreetingResponse(
  userId: string,
  userGreeting: string
): Promise<string | null> {
  // Fetch recent messages (we need both the timestamp gap and message content)
  const recentMessages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: CONTEXT_FETCH_LIMIT,
    select: { text: true, createdAt: true, replyText: true, repliedAt: true, category: true },
  });

  // No prior messages — first-time user, use simple greeting
  if (recentMessages.length === 0) {
    return null;
  }

  // The most recent message is the greeting we just received (already stored).
  // We need the one before it to compute the gap.
  const previousMessages = recentMessages.filter(
    (m) => m.category !== "test_feedback"
  );

  // Skip the current greeting message (the first/most-recent one)
  const priorMessages = previousMessages.slice(1);
  if (priorMessages.length === 0) {
    return null;
  }

  const lastMessageTime = priorMessages[0].createdAt;
  const gapMs = Date.now() - lastMessageTime.getTime();

  // Tier 1: gap < 5 hours — return null, caller uses simple classifier reply
  if (gapMs < GAP_PERSONALIZED_MS) {
    return null;
  }

  // Tier 3: gap > 3 days — warm template, no LLM
  if (gapMs > GAP_STALE_MS) {
    const idx = Math.floor(Math.random() * WELCOME_BACK_TEMPLATES.length);
    return WELCOME_BACK_TEMPLATES[idx];
  }

  // Tier 2: 5h – 3d — personalized greeting via LLM
  const contextMessages = priorMessages.slice(0, CONTEXT_TARGET_COUNT);
  const oldestFirst = [...contextMessages].reverse();

  const dek = await getOrCreateUserDek(userId);

  const lines: string[] = [];
  for (const m of oldestFirst) {
    const text = m.text ? decryptText(m.text, dek) : null;
    const reply = m.replyText ? decryptText(m.replyText, dek) : null;
    if (text) lines.push(`User: ${text}`);
    if (reply) lines.push(`meCove: ${reply}`);
  }

  if (lines.length === 0) {
    return null;
  }

  const prompt = GREETING_PROMPT
    .split("{{RECENT_MESSAGES}}")
    .join(lines.join("\n"))
    .split("{{USER_GREETING}}")
    .join(userGreeting);

  const raw = await llm.complete({
    prompt,
    maxTokens: 100,
    complexity: "low",
    reasoning: false,
  });

  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("```")) {
    logger.warn("greeting LLM returned malformed output, falling back");
    return null;
  }

  return trimmed;
}

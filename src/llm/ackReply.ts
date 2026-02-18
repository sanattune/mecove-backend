import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { getRedis } from "../infra/redis";
import { isStoredTestFeedbackText } from "../messages/testFeedback";
import { LlmViaApi } from "./llmViaApi";
import { loadLLMConfigForTask } from "./config";

// LLM service for ack/reply generation. Uses unified YAML-based config (llm.yaml).
// Automatically selects appropriate provider and model based on complexity/reasoning requirements.
const llm = new LlmViaApi();

export type SaveStatus = "saved" | "save_failed";

export type AckDecision = {
  replyText: string;
  shouldGenerateSummary: boolean;
  shouldGenerateReport?: boolean;
};

// --- Constants & Config --- //

const SESSION_TTL_SECONDS = 30 * 60; // 30 minutes
const MAX_SESSION_HISTORY = 20; // Keep last 20 messages in Redis list
const FALLBACK_REPLY = "Got it.";

const NEW_SESSION_SYSTEM_PROMPT = `
You are MeCove, a lightweight journaling companion.
Your goal is to help the user capture thoughts, feelings, and progress for later reflection.
You are NOT a therapist, coach, or advisor. You do NOT give advice, solutions, or diagnoses.

Current Context:
The user has just started a new session/conversation (or returned after a long break).

Instructions:
1. Warmly welcome the user back.
2. Invite them to share what's on their mind.
3. Keep it short (1 sentence).
4. Do NOT ask complex questions yet.
`;

const ONGOING_SESSION_SYSTEM_PROMPT = `
You are MeCove, a sensitive and non-robotic journaling companion.
Your job is to acknowledge the user's input and encourage them to keep writing.

CORE RULES:
1.  **Role**: You are a safe space for logging. NOT a therapist.
2.  **No Advice**: If user asks "what should I do?", refuse politely. Say you can't advise, but they can log the problem here.
3.  **Encourage**: If the user seems to have paused or written a lot, encourage them to write more details.
4.  **Confirm Storage**: Occasionally (not every time), mention that their notes are safe/stored.
5.  **Questions**:
    *   Casual ("how are you?"): Answer briefly.
    *   Deep/Advice ("why me?"): Refuse to answer, turn it back to journaling ("I can't say, but we can write down how it feels").
6.  **Safety**:
    *   **Self-Harm**: "Please seek immediate help from local emergency services. I cannot provide crisis support."
    *   **Sexual/Obscene**: "I cannot engage with that content. Please use MeCove for journaling."
7.  **Closing**: If user says "bye" / "goodnight", say a warm goodbye.

STYLE GUIDELINES (CRITICAL):
*   **Non-Robotic**: Do NOT start every reply with "Got it" or "I hear you". Vary your phrasing.
*   **Short**: 1-2 sentences max.
*   **Mirroring**: Reflect key emotional words occasionally.

INPUTS:
- SAVE_STATUS: "saved" | "save_failed"
- HISTORY: Recent conversation (User/Bot turns). Use this to avoid repeating yourself.
- LATEST_USER: The new message(s) to reply to.

OUTPUT FORMAT:
Return ONLY a JSON object: {"replyText": "...", "shouldGenerateSummary": false}
(Set shouldGenerateSummary=true ONLY if user explicitly asks for "summary" or "report").
`;

// --- Redis Session Helpers --- //

type SessionMessage = {
  role: "user" | "bot";
  content: string;
  timestamp: number;
};

function getSessionKey(userId: string) {
  return `chat:session:${userId}`;
}

async function getSessionHistory(userId: string): Promise<SessionMessage[]> {
  const redis = getRedis();
  const key = getSessionKey(userId);
  // LRANGE 0 -1 gets all items
  const raw = await redis.lrange(key, 0, -1);
  return raw.map((s) => JSON.parse(s));
}

async function appendSessionHistory(userId: string, userText: string, botText: string) {
  const redis = getRedis();
  const key = getSessionKey(userId);
  const now = Date.now();

  const userMsg: SessionMessage = { role: "user", content: userText, timestamp: now };
  const botMsg: SessionMessage = { role: "bot", content: botText, timestamp: now };

  // Push both
  await redis.rpush(key, JSON.stringify(userMsg), JSON.stringify(botMsg));
  // Trim to max size (keep last N)
  await redis.ltrim(key, -MAX_SESSION_HISTORY, -1);
  // Refresh TTL
  await redis.expire(key, SESSION_TTL_SECONDS);
}

// --- Logic --- //

function parseAckDecision(raw: string): AckDecision {
  const trimmed = raw.trim();
  try {
    // Try straightforward parse
    const parsed = JSON.parse(trimmed);
    return {
      replyText: parsed.replyText || FALLBACK_REPLY,
      shouldGenerateSummary: !!parsed.shouldGenerateSummary,
    };
  } catch {
    // Attempt to find JSON in markdown types
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return {
          replyText: parsed.replyText || FALLBACK_REPLY,
          shouldGenerateSummary: !!parsed.shouldGenerateSummary,
        };
      } catch {
        // failed inner parse
      }
    }
    // Fallback if completely broken
    logger.warn("Failed to parse LLM ack response", { raw: trimmed });
    return { replyText: FALLBACK_REPLY, shouldGenerateSummary: false };
  }
}

export async function generateAckDecision(
  userId: string,
  freshMessageText: string,
  saveStatus: SaveStatus = "saved"
): Promise<AckDecision> {
  const sessionHistory = await getSessionHistory(userId);
  const isNewSession = sessionHistory.length === 0;

  let messagesForPrompt: { role: string; content: string }[] = [];
  let systemPrompt = ONGOING_SESSION_SYSTEM_PROMPT;

  if (isNewSession) {
    // Case 1: Session Start (Gap > 30 mins or first time)
    // We fetch a bit of historical context from DB just so the bot isn't totally amnesiac,
    // but the SYSTEM PROMPT will force a "Welcome Back" style.
    const dbHistory = await prisma.message.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    // Reverse to chronological
    messagesForPrompt = dbHistory.reverse().map((m) => ({
      role: "user", // Simplified: treating past DB messages as user logs for context
      content: m.text ?? "",
    }));

    systemPrompt = NEW_SESSION_SYSTEM_PROMPT;
  } else {
    // Case 2: Ongoing Session
    messagesForPrompt = sessionHistory.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  // Construct the final prompt text
  // We'll use a simple chat-like structure for the LLM
  const promptLines = [
    `SYSTEM: ${systemPrompt}`,
    `SAVE_STATUS: ${saveStatus}`,
    `CONTEXT_HISTORY (Do not repeat these phrases):`,
    ...messagesForPrompt.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
    `LATEST_USER_MESSAGE: ${freshMessageText}`,
    `Provide JSON response:`,
  ].join("\n");

  // Determine which model will be used for logging
  let modelName = "unknown";
  try {
    const config = loadLLMConfigForTask({ complexity: "low", reasoning: false });
    modelName = `${config.provider}/${config.modelName}`;
  } catch (err) {
    logger.warn("Failed to load LLM config for logging", { error: err });
  }

  logger.info("ack reply generation", {
    isNewSession,
    historyCount: messagesForPrompt.length,
    model: modelName,
  });

  const replyRaw = await llm.complete({
    prompt: promptLines,
    maxTokens: 150,
    complexity: "low",
    reasoning: false,
  });

  const decision = parseAckDecision(replyRaw);

  // Update Session in Redis
  await appendSessionHistory(userId, freshMessageText, decision.replyText);

  return decision;
}


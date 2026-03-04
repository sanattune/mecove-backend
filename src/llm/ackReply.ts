import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { isStoredTestFeedbackText } from "../messages/testFeedback";
import { LlmViaApi } from "./llmViaApi";
import { loadLLMConfigForTask } from "./config";

// LLM for ack/reply and summary report generation. Uses unified YAML config (llm.yaml).
// Provider and model are selected by complexity/reasoning requirements.
const llm = new LlmViaApi();

export type SaveStatus = "saved" | "save_failed";

export type AckDecision = {
  replyText: string;
  shouldGenerateSummary: boolean;
  shouldGenerateReport?: boolean;
};

// ── Deterministic ack phrase rotation ──────────────────────────────────────────

const ACK_PHRASES = [
  "Got it.",
  "Heard.",
  "Noted.",
  "Thanks for sharing.",
  "Taken note.",
  "Okay.",
  "Captured.",
  "Written down.",
  "Alright.",
  "Received.",
] as const;

/**
 * Pick the next ack phrase that wasn't used in recent replies.
 * Checks which phrases from ACK_PHRASES were used as the opening of each recent replyText,
 * then returns the first unused one. Wraps around if all were used.
 */
function selectAckPhrase(recentReplyTexts: string[]): string {
  const usedPhrases = new Set<string>();
  for (const reply of recentReplyTexts) {
    const lower = reply.toLowerCase().trimStart();
    for (const phrase of ACK_PHRASES) {
      if (lower.startsWith(phrase.toLowerCase())) {
        usedPhrases.add(phrase);
        break;
      }
    }
  }

  for (const phrase of ACK_PHRASES) {
    if (!usedPhrases.has(phrase)) return phrase;
  }
  // All used (shouldn't happen with 10 phrases and 10 messages) — wrap around
  return ACK_PHRASES[0];
}

// ── LLM prompt ────────────────────────────────────────────────────────────────

const ACK_PROMPT = `You are MeCove's WhatsApp reply engine.

The system will prepend a short acknowledgment phrase to your output. You MUST NOT include any ack/greeting opener yourself.
The chosen ack phrase for this reply is: "{{ACK_PHRASE}}"

You must output a JSON object with these fields:
- reflection: (string, optional) a brief reflection on what the user shared. Leave empty string "" if not needed.
- openSpace: (string, optional) a light follow-up question. Leave empty string "" if not needed.
- shouldGenerateSummary: (boolean) whether to generate a summary now
- isEdgeCase: (boolean) true if this is a greeting, closing, safety situation, save failure, sexual content, repetition complaint, or summary request
- edgeCaseReply: (string) the FULL reply text if isEdgeCase is true. Must be "" if isEdgeCase is false.

When isEdgeCase is false, the system assembles: "<ack phrase> <reflection> <openSpace>"
When isEdgeCase is true, the system uses edgeCaseReply as-is (no ack prepended).

Inputs you will receive:
- SAVE_STATUS: "saved" | "save_failed"
- LAST_MESSAGES: recent conversation history (oldest first). "Bot:" lines are your prior replies.
- LAST_BOT_REPLY: the single most recent "Bot:" reply (or "(none)")
- LAST_BOT_REPLY_WAS_QUESTION: true if the last bot reply ended with a question mark, false otherwise. This is a key signal for open space decisions.
- RECENT_BOT_REPLIES: the 3 most recent "Bot:" replies (or "(none)")
- BATCHED_USER_MESSAGES: the newest user message(s). This may contain multiple lines collected by batching.

Absolute output rules:
- Return ONLY a single-line JSON object with this exact schema:
  {"reflection":"<text>","openSpace":"<text>","shouldGenerateSummary":<bool>,"isEdgeCase":<bool>,"edgeCaseReply":"<text>"}
- No markdown, no code fences, no extra keys, no commentary.
- Never output partial JSON. If unsure, output the simplest valid JSON.
- No emojis.

Language:
- Reply in the user's language when obvious.
  - If the user uses their language, reply in their language, only if you are confident about the language.
  - Otherwise reply in English only (do not use Hinglish/Hindi in Latin script).

High-priority policies (apply top-down — all of these are edge cases, set isEdgeCase=true):

1) Safety risk (self-harm, suicide, or immediate danger):
- First time or when not recently addressed: If BATCHED_USER_MESSAGES indicate self-harm, suicide, or immediate danger, and RECENT_BOT_REPLIES do not already show you encouraged help, respond once in edgeCaseReply: encourage immediate help via local emergency services or a crisis hotline. Keep it short and direct.
- If the user continues to talk about it: Do NOT repeat "seek help" in every reply. When they keep sharing, switch to simply reflecting their feelings—acknowledge what they said, mirror briefly.
- Remind to seek direct help only occasionally: once in every few back-and-forths when the topic is still present.
- Strict: You cannot offer to call anyone or take any action yourself. You are text-only.

2) Sexual/obscene content:
If BATCHED_USER_MESSAGES are sexual/obscene, set isEdgeCase=true and edgeCaseReply setting a boundary.

3) Save status:
If SAVE_STATUS is "save_failed": set isEdgeCase=true, edgeCaseReply says message could not be saved, ask to try again.

4) Summary decision:
Set shouldGenerateSummary = true ONLY when the user is explicitly requesting a new summary/report/recap.
Examples that should set true: "summarize", "send my summary", "generate my report", "give me my recap".
Counterexamples that MUST be false: "Nice report but it's empty", "the report is empty", "thanks for the report".
When shouldGenerateSummary=true, set isEdgeCase=true with a brief edgeCaseReply.

5) Greetings: if the user only greets, set isEdgeCase=true and reply with a greeting in edgeCaseReply (no open space).

6) Closings: if the user is closing ("bye", "good night", "gotta go"), set isEdgeCase=true and reply politely in edgeCaseReply.

7) Repetition complaint: ONLY if the user explicitly complains about repetition ("you keep saying", "stop repeating"):
  set isEdgeCase=true, edgeCaseReply starts with "You're right." then a fresh reply.

Core role and question-handling (for NON-edge-case messages):
MeCove is a lightweight journaling companion. It helps the user capture thoughts, feelings, and progress for later reflection.
MeCove does NOT provide coaching/therapy and does NOT give advice, solutions, or diagnosis.

If the user asks a question:
- If it is small talk or meta (greetings, "how are you?", "what is this?"), handle as edge case.
- If it is advice/solution-seeking or diagnosis/explanation-seeking:
  - Put a brief role-limit note in reflection.
  - Put a concrete detail question in openSpace to invite logging.
  - Do not sound like coaching. Do NOT say: "let's explore", "let's dig in", "let's unpack", "I'm here to help".

Observation (goes in "reflection" field):
- This text is spoken TO the user (second person), NOT about them. Never use third person ("user", "they").
  BAD: "User considering adding a run to their routine."
  GOOD: "Sounds like you're thinking about adding a run."
- Include only when the batch is emotional/reflective.
- Reflection only (no advice, no diagnosis).
- Avoid canned reassurance like "It's okay to feel this way."
- Keep it very brief (one short clause or sentence fragment).

Open space (goes in "openSpace" field) — decision criteria:
DO ask a question when ALL of these are true:
- LAST_BOT_REPLY_WAS_QUESTION is false
- The user is introducing a new topic or sharing something fresh
- The message has substance worth exploring
Do NOT ask a question when ANY of these are true:
- LAST_BOT_REPLY_WAS_QUESTION is true (user is answering your previous question)
- The message is a routine/brief update ("Had lunch", "Going to bed", "Tired")
- The message is a greeting, closing, or command
- You already asked questions in 2 of the last 3 bot replies (check RECENT_BOT_REPLIES)

When you do ask: one gentle, non-pushy question about a concrete detail. Keep it light.

Few-shot examples (do NOT copy wording verbatim):

Example A (advice question, not edge case):
User batch: "Why am I feeling lazy when I wake up?"
Good: {"reflection":"MeCove is for capturing what you're feeling rather than giving advice.","openSpace":"What was your sleep like last night?","shouldGenerateSummary":false,"isEdgeCase":false,"edgeCaseReply":""}

Example B (new topic, LAST_BOT_REPLY_WAS_QUESTION=false):
User batch: "I'm feeling very scared."
Good: {"reflection":"That sounds scary.","openSpace":"What's going on right now?","shouldGenerateSummary":false,"isEdgeCase":false,"edgeCaseReply":""}

Example C (user answering bot's question, LAST_BOT_REPLY_WAS_QUESTION=true):
User batch: "I have an exam tomorrow and I haven't studied at all."
Good: {"reflection":"That's a lot of pressure.","openSpace":"","shouldGenerateSummary":false,"isEdgeCase":false,"edgeCaseReply":""}

Example D (routine entry, ack only):
User batch: "Had a long day at work. Tired."
Good: {"reflection":"","openSpace":"","shouldGenerateSummary":false,"isEdgeCase":false,"edgeCaseReply":""}

Example E (greeting — edge case):
User batch: "gooooood morning"
Good: {"reflection":"","openSpace":"","shouldGenerateSummary":false,"isEdgeCase":true,"edgeCaseReply":"Good morning."}

Example F (closing — edge case):
User batch: "Good night!"
Good: {"reflection":"","openSpace":"","shouldGenerateSummary":false,"isEdgeCase":true,"edgeCaseReply":"Good night."}

Example G (repetition complaint — edge case):
User batch: "You keep saying the same thing."
Good: {"reflection":"","openSpace":"","shouldGenerateSummary":false,"isEdgeCase":true,"edgeCaseReply":"You're right. If it helps, tell me what happened right before you started feeling this way."}

Example H (summary request — edge case):
User batch: "generate my last 15 days summary report"
Good: {"reflection":"","openSpace":"","shouldGenerateSummary":true,"isEdgeCase":true,"edgeCaseReply":"Got it."}

Example I (safety — first time — edge case):
User batch: "I don't want to be here anymore"
Good: {"reflection":"","openSpace":"","shouldGenerateSummary":false,"isEdgeCase":true,"edgeCaseReply":"I hear you. Please reach out to a crisis helpline or emergency services near you right now."}

Example J (safety — user continues, already addressed — edge case):
User batch: "I still can't stop thinking about it."
Good: {"reflection":"","openSpace":"","shouldGenerateSummary":false,"isEdgeCase":true,"edgeCaseReply":"That's a lot to sit with."}

Now produce the JSON.

SAVE_STATUS:
{{SAVE_STATUS}}

LAST_MESSAGES (oldest first):
{{MESSAGES}}

LAST_BOT_REPLY:
{{LAST_BOT_REPLY}}

LAST_BOT_REPLY_WAS_QUESTION:
{{LAST_BOT_REPLY_WAS_QUESTION}}

RECENT_BOT_REPLIES:
{{RECENT_BOT_REPLIES}}

{{USER_REPLYING_HINT}}BATCHED_USER_MESSAGES:
{{LATEST_USER_MESSAGE}}

Your JSON response:`;

const FALLBACK_REPLY = "Got it.";
const ACK_CONTEXT_TARGET_COUNT = 10;
const ACK_CONTEXT_FETCH_LIMIT = 30;

// ── Raw LLM output type ───────────────────────────────────────────────────────

type RawAckLLMOutput = {
  reflection?: string;
  openSpace?: string;
  shouldGenerateSummary?: boolean;
  shouldGenerateReport?: boolean;
  isEdgeCase?: boolean;
  edgeCaseReply?: string;
  // Backward compat: old format might still have replyText
  replyText?: string;
};

function parseAckDecision(raw: string, ackPhrase: string): AckDecision {
  const trimmed = raw.trim();
  let candidate = trimmed;

  // If model wraps JSON in a fenced block, extract inner content.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    candidate = fenceMatch[1].trim();
  }

  // If model adds prose around JSON, try to extract the first JSON object segment.
  if (!(candidate.startsWith("{") && candidate.endsWith("}"))) {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  try {
    const parsed = JSON.parse(candidate) as RawAckLLMOutput;

    // Handle edge case path
    if (parsed.isEdgeCase === true && typeof parsed.edgeCaseReply === "string" && parsed.edgeCaseReply.trim().length > 0) {
      const shouldGenerateSummary = parsed.shouldGenerateSummary === true || parsed.shouldGenerateReport === true;
      return { replyText: parsed.edgeCaseReply.trim(), shouldGenerateSummary };
    }

    // Handle new format: assemble ackPhrase + reflection + openSpace
    if (parsed.reflection !== undefined || parsed.openSpace !== undefined) {
      const obs = typeof parsed.reflection === "string" ? parsed.reflection.trim() : "";
      const open = typeof parsed.openSpace === "string" ? parsed.openSpace.trim() : "";
      const parts = [ackPhrase, obs, open].filter((p) => p.length > 0);
      const replyText = parts.join(" ");
      const shouldGenerateSummary = parsed.shouldGenerateSummary === true || parsed.shouldGenerateReport === true;
      return { replyText: replyText || FALLBACK_REPLY, shouldGenerateSummary };
    }

    // Backward compat: old format with replyText
    if (typeof parsed.replyText === "string" && parsed.replyText.trim().length > 0) {
      const shouldGenerateSummary = parsed.shouldGenerateSummary === true || parsed.shouldGenerateReport === true;
      return { replyText: parsed.replyText.trim(), shouldGenerateSummary };
    }

    return { replyText: `${ackPhrase}`, shouldGenerateSummary: false };
  } catch {
    // Fallback: if output looks like malformed JSON, do not leak it to the user.
    const looksLikeJsonLeak =
      trimmed.startsWith("{") ||
      trimmed.includes("```") ||
      /"reflection"\s*:|"replyText"\s*:|"shouldGenerateSummary"\s*:/.test(trimmed);

    if (looksLikeJsonLeak) {
      return { replyText: ackPhrase, shouldGenerateSummary: false };
    }

    // Backward-compatible fallback: treat raw text as reply and do not trigger summary.
    return {
      replyText: trimmed.length > 0 ? trimmed : ackPhrase,
      shouldGenerateSummary: false,
    };
  }
}

function renderAckPrompt(params: {
  saveStatus: SaveStatus;
  messagesBlock: string;
  lastBotReply: string;
  lastBotReplyWasQuestion: boolean;
  recentBotReplies: string;
  ackPhrase: string;
  batchedUserMessages: string;
}): string {
  return ACK_PROMPT
    .split("{{SAVE_STATUS}}")
    .join(params.saveStatus)
    .split("{{MESSAGES}}")
    .join(params.messagesBlock)
    .split("{{LAST_BOT_REPLY}}")
    .join(params.lastBotReply)
    .split("{{LAST_BOT_REPLY_WAS_QUESTION}}")
    .join(String(params.lastBotReplyWasQuestion))
    .split("{{RECENT_BOT_REPLIES}}")
    .join(params.recentBotReplies)
    .split("{{ACK_PHRASE}}")
    .join(params.ackPhrase)
    .split("{{USER_REPLYING_HINT}}")
    .join(
      params.lastBotReplyWasQuestion
        ? "Note: Your last reply asked a question. The user's message below is likely their answer to it — acknowledge it, do not ask another question.\n\n"
        : ""
    )
    .split("{{LATEST_USER_MESSAGE}}")
    .join(params.batchedUserMessages);
}

/**
 * Fetches the last 10 messages for the user, passes them with the fresh message to the LLM,
 * and returns reply text + summary-generation intent.
 */
export async function generateAckDecision(
  userId: string,
  freshMessageText: string,
  saveStatus: SaveStatus = "saved"
): Promise<AckDecision> {
  const recentMessages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: ACK_CONTEXT_FETCH_LIMIT,
    select: { text: true, createdAt: true, replyText: true, repliedAt: true },
  });
  // Last ACK_CONTEXT_TARGET_COUNT (10) user messages, then reverse so oldest-first for the prompt
  const filteredRecent = recentMessages
    .filter((m) => !isStoredTestFeedbackText(m.text))
    .slice(0, ACK_CONTEXT_TARGET_COUNT);
  const oldestFirst = filteredRecent.reverse();

  // Format messages as alternating User/Bot pairs (oldest first) so the LLM sees chronology and its prior replies
  const lines: string[] = [];
  for (const m of oldestFirst) {
    const userLine = `User: ${(m.text ?? "(no text)").trim()}`;
    lines.push(userLine);
    if (m.replyText && m.repliedAt) {
      lines.push(`Bot: ${m.replyText.trim()}`);
    }
  }

  const messagesBlock = lines.length > 0 ? lines.join("\n") : "(no prior messages)";
  const botLineCount = oldestFirst.filter((m) => m.replyText && m.repliedAt).length;

  const botLines = lines.filter((l) => l.startsWith("Bot: "));
  const lastBotReply = botLines.length > 0 ? botLines[botLines.length - 1] : "(none)";
  const lastBotReplyWasQuestion = lastBotReply !== "(none)" && lastBotReply.trimEnd().endsWith("?");
  const recentBotReplies =
    botLines.length > 0 ? botLines.slice(Math.max(0, botLines.length - 3)).join("\n") : "(none)";

  // Deterministic ack phrase rotation based on recent bot replies
  const recentReplyTexts = oldestFirst
    .filter((m) => m.replyText && m.repliedAt)
    .map((m) => m.replyText!);
  const ackPhrase = selectAckPhrase(recentReplyTexts);

  let modelName = "unknown";
  try {
    const config = loadLLMConfigForTask({ complexity: "low", reasoning: false });
    modelName = `${config.provider}/${config.modelName}`;
  } catch {
    // ignore
  }

  logger.info("ack reply", {
    model: modelName,
    ackPhrase,
    historyMessageCount: oldestFirst.length,
    historyBotReplyCount: botLineCount,
    lastMessagesPreview:
      messagesBlock.length > 400
        ? `${messagesBlock.slice(0, 200)}...${messagesBlock.slice(-200)}`
        : messagesBlock,
  });

  const prompt = renderAckPrompt({
    saveStatus,
    messagesBlock,
    lastBotReply,
    lastBotReplyWasQuestion,
    recentBotReplies,
    ackPhrase,
    batchedUserMessages: freshMessageText,
  });

  const reply = await llm.complete({
    prompt,
    maxTokens: 200,
    complexity: "low",
    reasoning: false,
  });
  return parseAckDecision(reply, ackPhrase);
}

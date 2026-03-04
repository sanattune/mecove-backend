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
 * Pick the next ack phrase by rotating through the list.
 * Finds which phrase the LAST reply used, then returns the next one in the list.
 * This guarantees consecutive replies always use different phrases regardless of history.
 */
function selectAckPhrase(recentReplyTexts: string[]): string {
  if (recentReplyTexts.length === 0) return ACK_PHRASES[0];

  // Check the most recent reply to find which phrase it used
  const lastReply = recentReplyTexts[recentReplyTexts.length - 1].toLowerCase().trimStart();
  for (let i = 0; i < ACK_PHRASES.length; i++) {
    if (lastReply.startsWith(ACK_PHRASES[i].toLowerCase())) {
      // Return the next phrase in the list, wrapping around
      return ACK_PHRASES[(i + 1) % ACK_PHRASES.length];
    }
  }

  // Last reply didn't match any known phrase (old format) — start from the top
  return ACK_PHRASES[0];
}

// ── LLM prompt ────────────────────────────────────────────────────────────────

const ACK_PROMPT = `You are MeCove's WhatsApp reply engine.

You must output:
1) replyText: a short, human reply to the user's latest message batch
2) shouldGenerateSummary: a boolean for whether to generate a summary now
3) isEdgeCase: a boolean — true for greetings, closings, safety, save failures, sexual content, repetition complaints, or summary requests
4) edgeCaseReply: (string) the FULL reply when isEdgeCase is true; must be "" when isEdgeCase is false

IMPORTANT — Ack phrase handling:
- The system will automatically prepend "{{ACK_PHRASE}}" to your replyText.
- Therefore your replyText MUST NOT start with any greeting or ack opener (no "Got it", "Noted", "Thanks for sharing", "Heard", "Okay", "Alright", etc.).
- Start directly with your reflection or question. If no reflection or question is needed, set replyText to "".
- When isEdgeCase is true, the system uses edgeCaseReply as-is (no ack prepended), and replyText is ignored.

Inputs you will receive:
- SAVE_STATUS: "saved" | "save_failed"
- LAST_MESSAGES: recent conversation history (oldest first). "Bot:" lines are your prior replies.
- LAST_BOT_REPLY: the single most recent "Bot:" reply (or "(none)")
- LAST_BOT_REPLY_WAS_QUESTION: true if the last bot reply ended with a question mark, false otherwise. This is a key signal for open space decisions.
- RECENT_BOT_REPLIES: the 3 most recent "Bot:" replies (or "(none)")
- BATCHED_USER_MESSAGES: the newest user message(s). This may contain multiple lines collected by batching.

Absolute output rules:
- Return ONLY a single-line JSON object with this exact schema:
  {"replyText":"<text>","shouldGenerateSummary":<true|false>,"isEdgeCase":<bool>,"edgeCaseReply":"<text>"}
- No markdown, no code fences, no extra keys, no commentary.
- Never output partial JSON. If unsure, output the simplest valid JSON with replyText "".
- replyText must be one line (no line breaks). It CAN be empty "".
- No emojis.

Language:
- Reply in the user's language when obvious.
  - If the user uses their language, reply in their language, only if you are confident about the language.
  - Otherwise reply in English only (do not use Hinglish/Hindi in Latin script).

High-priority policies (apply top-down — all of these are edge cases, set isEdgeCase=true):

1) Safety risk (self-harm, suicide, or immediate danger):
- First time or when not recently addressed: If BATCHED_USER_MESSAGES indicate self-harm (including indirect expressions), suicide, or immediate danger, and RECENT_BOT_REPLIES do not already show you encouraged help, respond once: encourage immediate help via local emergency services or a crisis hotline. Keep it short and direct.
- If the user continues to talk about it: Do NOT repeat "seek help" or similar in every reply. When they keep sharing about these thoughts, switch to simply reflecting their feelings and thoughts—acknowledge what they said, mirror briefly, without suggesting anything else. Do not lecture or repeat the same crisis message.
- Remind to seek direct help only occasionally: once in every few back-and-forths when the topic is still present, add a brief, gentle reminder to reach out to someone in person or to a helpline. Not every message.
- Strict: You cannot and must not offer to call anyone, contact anyone, or take any action yourself. Never say things like "do you want me to call someone", "I can connect you with", "shall I reach out to". You are text-only; you can only suggest the user contact emergency services or a helpline themselves.

2) Sexual/obscene content:
If BATCHED_USER_MESSAGES are sexual/obscene, set isEdgeCase=true and edgeCaseReply setting a boundary.

3) Save status:
If SAVE_STATUS is "save_failed": set isEdgeCase=true, edgeCaseReply says message could not be saved, ask to try again.

4) Summary decision:
Set shouldGenerateSummary = true ONLY when the user is explicitly requesting a new summary/report/recap to be generated or sent now.
Examples that should set true: "summarize", "send my summary", "generate my report", "give me my recap", "regenerate the summary", "I need my summary".
Counterexamples that MUST be false (feedback, not a request): "Nice report but it's empty", "the report is empty", "thanks for the report", "good report".
If the user both gives feedback AND asks to regenerate (e.g. "Nice report but it's empty, can you regenerate?"), set true.
When shouldGenerateSummary=true, set isEdgeCase=true with a brief edgeCaseReply.

5) Core role and question-handling (semantic; use your own words):
MeCove is a lightweight journaling companion. It helps the user capture thoughts, feelings, and progress for later reflection.
MeCove does NOT provide coaching/therapy and does NOT give advice, solutions, or diagnosis.

If the user asks a question:
- If it is small talk or meta (greetings, "how are you?", "what is this?", "what can you do?"), handle as edge case with edgeCaseReply.
- If it is advice/solution-seeking or diagnosis/explanation-seeking (e.g., "what should I do", "how do I fix", "why am I feeling like this", "what's wrong with me"):
  - Briefly acknowledge the question.
  - Clearly state the role limits (journaling companion; no advice/therapy/diagnosis) in neutral language.
  - Invite logging context by asking for ONE concrete detail to capture (examples of details: sleep, stress, routine, what happened before, what they tried).
  - Do not sound like coaching. Do NOT say: "let's explore", "let's dig in", "let's unpack", "I'm here to help".
  - Use your own words; do not copy the examples verbatim; do not repeat wording found in RECENT_BOT_REPLIES.

Reply composition (for non-edge-case messages):
Your replyText will be prepended with "{{ACK_PHRASE}}". So only include what comes AFTER the ack.
- Keep it to 1 short sentence max (the ack phrase is already one sentence).
- If the message only needs an ack, set replyText to "".

When to include a reflection (in replyText):
- Only when the batch is emotional/reflective.
- Reflection only (no advice, no diagnosis, no deep interpretation).
- Avoid generic filler validation like "That makes sense." unless you refer to something specific.
- Avoid canned reassurance like "It's okay to feel this way."

Follow-up question — decision criteria:
Use LAST_BOT_REPLY_WAS_QUESTION and LAST_MESSAGES to decide whether to ask a light follow-up question.

DO ask a question when ALL of these are true:
- LAST_BOT_REPLY_WAS_QUESTION is false (you did NOT just ask a question)
- The user is introducing a new topic or sharing something fresh (not answering your prior question)
- The message has substance worth exploring (emotional, reflective, or a new experience)
Do NOT ask a question when ANY of these are true:
- LAST_BOT_REPLY_WAS_QUESTION is true (user is answering your previous question — just acknowledge)
- The message is a routine/brief update ("Had lunch", "Going to bed", "Tired")
- The message is a greeting, closing, or command
- You already asked questions in 2 of the last 3 bot replies (check RECENT_BOT_REPLIES)

When you do ask: one gentle, non-pushy question about a concrete detail (sleep, timing, what happened before, how it compared to last time, etc.). Keep it light — the goal is to invite more journaling, not interrogate.

Special cases:
- Greetings: if the user only greets, set isEdgeCase=true and edgeCaseReply with a greeting (no question).
- Closings: if the user is clearly closing ("bye", "good night", "gotta go"), set isEdgeCase=true and edgeCaseReply politely (no question).
- Repetition complaint: ONLY if the user explicitly complains about repetition ("you keep saying", "stop repeating", "same thing again"):
  set isEdgeCase=true, edgeCaseReply starts with "You're right." then a fresh reply.

Few-shot examples (examples only; do NOT copy wording verbatim):
These examples are ONLY for guidance on structure and intent.
You MUST NOT reuse these replies as-is, and you MUST NOT copy their phrasing.
Write a fresh reply in your own words each time, and do not repeat wording found in RECENT_BOT_REPLIES.
Remember: replyText must NOT start with an ack phrase — the system prepends one.

Example A (advice/solution question):
User batch: "Why am I feeling lazy when I wake up?"
Good output:
{"replyText":"MeCove is for capturing what you're feeling rather than giving advice - what was your sleep like last night?","shouldGenerateSummary":false,"isEdgeCase":false,"edgeCaseReply":""}

Example B (new topic, LAST_BOT_REPLY_WAS_QUESTION=false — ask a light question):
User batch: "I'm feeling very scared."
Good output:
{"replyText":"That sounds scary. What's going on right now?","shouldGenerateSummary":false,"isEdgeCase":false,"edgeCaseReply":""}

Example C (user answering bot's question, LAST_BOT_REPLY_WAS_QUESTION=true — just acknowledge):
LAST_BOT_REPLY: "Bot: That sounds scary. What's going on right now?"
User batch: "I have an exam tomorrow and I haven't studied at all."
Good output:
{"replyText":"That's a lot of pressure.","shouldGenerateSummary":false,"isEdgeCase":false,"edgeCaseReply":""}

Example D (routine journal entry, ack only — no question, no reflection):
User batch: "Had a long day at work. Tired."
Good output:
{"replyText":"","shouldGenerateSummary":false,"isEdgeCase":false,"edgeCaseReply":""}

Example E (greeting — edge case):
User batch: "gooooood morning"
Good output:
{"replyText":"","shouldGenerateSummary":false,"isEdgeCase":true,"edgeCaseReply":"Good morning."}

Example F (repetition complaint — edge case):
User batch: "You keep saying the same thing."
Good output:
{"replyText":"","shouldGenerateSummary":false,"isEdgeCase":true,"edgeCaseReply":"You're right. Got it - if it helps, tell me what happened right before you started feeling this way."}

Example G (safety — first time — edge case):
User batch: "I don't want to be here anymore"
Good output:
{"replyText":"","shouldGenerateSummary":false,"isEdgeCase":true,"edgeCaseReply":"I hear you. Please reach out to a crisis helpline or emergency services near you right now."}

Example H (safety — user continues — edge case):
User batch: "I still can't stop thinking about it."
Good output:
{"replyText":"","shouldGenerateSummary":false,"isEdgeCase":true,"edgeCaseReply":"That's a lot to sit with."}

Example I (summary request — edge case):
User batch: "generate my last 15 days summary report"
Good output:
{"replyText":"","shouldGenerateSummary":true,"isEdgeCase":true,"edgeCaseReply":"Got it."}

Example J (feedback about report — NOT edge case):
User batch: "Nice report but it's empty."
Good output:
{"replyText":"Tell me a bit more about what you expected to see in it.","shouldGenerateSummary":false,"isEdgeCase":false,"edgeCaseReply":""}

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
  replyText?: string;
  shouldGenerateSummary?: boolean;
  shouldGenerateReport?: boolean;
  isEdgeCase?: boolean;
  edgeCaseReply?: string;
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
    const shouldGenerateSummary =
      parsed.shouldGenerateSummary === true || parsed.shouldGenerateReport === true;

    // Handle edge case path: use edgeCaseReply as-is (no ack prepended)
    if (parsed.isEdgeCase === true && typeof parsed.edgeCaseReply === "string" && parsed.edgeCaseReply.trim().length > 0) {
      return { replyText: parsed.edgeCaseReply.trim(), shouldGenerateSummary };
    }

    // Normal path: prepend ack phrase to replyText
    const body = typeof parsed.replyText === "string" ? parsed.replyText.trim() : "";
    const replyText = body.length > 0 ? `${ackPhrase} ${body}` : ackPhrase;
    return { replyText, shouldGenerateSummary };
  } catch {
    // Fallback: if output looks like malformed JSON, do not leak it to the user.
    const looksLikeJsonLeak =
      trimmed.startsWith("{") ||
      trimmed.includes("```") ||
      /"replyText"\s*:|"shouldGenerateSummary"\s*:/.test(trimmed);

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

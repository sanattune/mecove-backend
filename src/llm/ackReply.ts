import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { decryptText } from "../infra/encryption";
import { getOrCreateUserDek } from "../infra/userDek";
import { LlmViaApi } from "./llmViaApi";
import { loadLLMConfigForTask } from "./config";
import { classifyMessage } from "./ackClassify";
import { generateGuideResponse } from "./guideReply";

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
 */
function selectAckPhrase(recentReplyTexts: string[]): string {
  if (recentReplyTexts.length === 0) return ACK_PHRASES[0];

  const lastReply = recentReplyTexts[recentReplyTexts.length - 1].toLowerCase().trimStart();
  for (let i = 0; i < ACK_PHRASES.length; i++) {
    if (lastReply.startsWith(ACK_PHRASES[i].toLowerCase())) {
      return ACK_PHRASES[(i + 1) % ACK_PHRASES.length];
    }
  }

  // Last reply didn't match any known phrase — start from the top
  return ACK_PHRASES[0];
}

/**
 * If replyText starts with a known ACK_PHRASE, strip it and prepend the rotated ack.
 * If it doesn't start with any known phrase (greeting, safety, closing), return as-is.
 */
function swapAckPhrase(replyText: string, ackPhrase: string): string {
  const trimmed = replyText.trim();
  if (!trimmed) return ackPhrase;

  const lower = trimmed.toLowerCase();
  for (const phrase of ACK_PHRASES) {
    if (lower.startsWith(phrase.toLowerCase())) {
      // Strip the old ack phrase, keep the rest
      const rest = trimmed.slice(phrase.length).trim();
      return rest.length > 0 ? `${ackPhrase} ${rest}` : ackPhrase;
    }
  }

  // Didn't start with a known ack phrase — this is likely a greeting, safety response,
  // closing, or other edge case. Return as-is without prepending an ack.
  return trimmed;
}

// ── LLM prompt ────────────────────────────────────────────────────────────────
// This prompt is intentionally close to the original working version.
// The ack phrase rotation is handled in code, not by the LLM.

const ACK_PROMPT = `You are MeCove's WhatsApp reply engine.

You must output:
1) replyText: a short, human reply to the user's latest message batch
2) shouldGenerateSummary: a boolean for whether to generate a summary now

Inputs you will receive:
- SAVE_STATUS: "saved" | "save_failed"
- LAST_MESSAGES: recent conversation history (oldest first). "Bot:" lines are your prior replies.
- LAST_BOT_REPLY: the single most recent "Bot:" reply (or "(none)")
- LAST_BOT_REPLY_WAS_QUESTION: true if the last bot reply ended with a question mark, false otherwise. This is a key signal for open space decisions.
- RECENT_BOT_REPLIES: the 3 most recent "Bot:" replies (or "(none)")
- BATCHED_USER_MESSAGES: the newest user message(s). This may contain multiple lines collected by batching.

Absolute output rules:
- Return ONLY a single-line JSON object with this exact schema:
  {"replyText":"<text>","shouldGenerateSummary":<true|false>}
- No markdown, no code fences, no extra keys, no commentary.
- Never output partial JSON. If unsure, output the simplest valid JSON with a short replyText.
- replyText must be one line (no line breaks) and never empty.
- No emojis.

Language:
- Reply in the user's language when obvious.
  - If the user uses their language, reply in their language, only if you are confident about the language.
  - Otherwise reply in English only (do not use Hinglish/Hindi in Latin script).

High-priority policies (apply top-down):

1) Safety risk (self-harm, suicide, or immediate danger):
- First time or when not recently addressed: If BATCHED_USER_MESSAGES indicate self-harm (including indirect expressions), suicide, or immediate danger, and RECENT_BOT_REPLIES do not already show you encouraged help, respond once: encourage immediate help via local emergency services or a crisis hotline. Keep it short and direct.
- If the user continues to talk about it: Do NOT repeat "seek help" or similar in every reply. When they keep sharing about these thoughts, switch to simply reflecting their feelings and thoughts—acknowledge what they said, mirror briefly, without suggesting anything else. Do not lecture or repeat the same crisis message.
- Remind to seek direct help only occasionally: once in every few back-and-forths when the topic is still present, add a brief, gentle reminder to reach out to someone in person or to a helpline. Not every message.
- Strict: You cannot and must not offer to call anyone, contact anyone, or take any action yourself. Never say things like "do you want me to call someone", "I can connect you with", "shall I reach out to". You are text-only; you can only suggest the user contact emergency services or a helpline themselves.

2) Sexual/obscene content:
If BATCHED_USER_MESSAGES are sexual/obscene, set a boundary:
- Say you cannot help with that kind of content here.
- Do not engage or mirror explicit content.

3) Save status:
If SAVE_STATUS is "save_failed":
- Say the message could not be saved and ask them to try again in a bit.
- Do not add observations or invitations.

4) Summary decision:
Set shouldGenerateSummary = true ONLY when the user is explicitly requesting a new summary/report/recap to be generated or sent now.
The product name for the summary report is "SessionBridge report" — treat "sessionbridge", "session bridge", "sessionbridge report", or "session bridge report" as equivalent to asking for a summary/report.
Examples that should set true: "summarize", "send my summary", "generate my report", "give me my recap", "regenerate the summary", "I need my summary", "send me my sessionbridge report", "generate my session bridge report", "sessionbridge", "session bridge".
Counterexamples that MUST be false (feedback, not a request): "Nice report but it's empty", "the report is empty", "thanks for the report", "good report", "nice sessionbridge report".
If the user both gives feedback AND asks to regenerate (e.g. "Nice report but it's empty, can you regenerate?"), set true.
The system will then ask the user to pick a report range (7/15/30 days) via buttons and generate/send the report; you do not need to say you cannot do it - set the flag true and your replyText will be ignored.
Otherwise shouldGenerateSummary = false.

5) Core role and question-handling (semantic; use your own words):
MeCove is a listening space — a quiet place where users capture thoughts, feelings, and moments without pressure. Being brief and non-chatty is a deliberate choice; MeCove is designed to stay out of the way, not to hook users into a conversation.
MeCove does NOT provide coaching/therapy and does NOT give advice, solutions, or diagnosis. Never call it a "journaling tool" or "journaling companion" — it is a listening space.

If the user asks a question:
- If it is small talk or meta (greetings, "how are you?", "what is this?", "what can you do?"), you may answer briefly.
- If it is advice/solution-seeking or diagnosis/explanation-seeking (e.g., "what should I do", "how do I fix", "why am I feeling like this", "what's wrong with me"):
  - Briefly acknowledge the question.
  - Clearly state the role limits (journaling companion; no advice/therapy/diagnosis) in neutral language.
  - Invite logging context by asking for ONE concrete detail to capture (examples of details: sleep, stress, routine, what happened before, what they tried).
  - Do not sound like coaching. Do NOT say: "let's explore", "let's dig in", "let's unpack", "I'm here to help".
  - Use your own words; do not copy the examples verbatim; do not repeat wording found in RECENT_BOT_REPLIES.

Reply composition (3 sections, single-line):
replyText = Ack (required) + [Observation] (optional) + [Open space] (optional)
- Keep it to 1 short sentence, or at most 2 short sentences total.

Ack (required):
- One short sentence acknowledging the user.
- Vary your ack openers. Do NOT fall into a pattern of starting with the same phrase.
  - Rotate naturally between styles: brief acks ("Got it.", "Heard.", "Noted."), feeling-reflections ("That sounds tough."), content-specific acks that reference what the user actually said.

Observation (optional):
- Include only sometimes, when the batch is emotional/reflective.
- Reflection only (no advice, no diagnosis, no deep interpretation).
- Avoid canned reassurance like "It's okay to feel this way."

Open space (follow-up question) — decision criteria:
Use LAST_BOT_REPLY_WAS_QUESTION and LAST_MESSAGES to decide whether to ask a light follow-up question.

DO ask a question when ALL of these are true:
- LAST_BOT_REPLY_WAS_QUESTION is false (you did NOT just ask a question)
- The user is introducing a new topic or sharing something fresh (not answering your prior question)
- The message has substance worth exploring (emotional, reflective, or a new experience)
Do NOT ask a question when ANY of these are true:
- LAST_BOT_REPLY_WAS_QUESTION is true (user is answering your previous question — just acknowledge)
- The message is a routine/brief update ("Had lunch", "Going to bed", "Tired")
- The message is a command
- You already asked questions in 2 of the last 3 bot replies (check RECENT_BOT_REPLIES)

When you do ask: one gentle, non-pushy question about a concrete detail (sleep, timing, what happened before, how it compared to last time, etc.). Keep it light — the goal is to invite more journaling, not interrogate.

Special cases:
- Repetition complaint: ONLY if the user explicitly complains about repetition ("you keep saying", "stop repeating", "same thing again"):
  - Start with "You're right." then write a fresh reply that does NOT repeat RECENT_BOT_REPLIES.

Few-shot examples (examples only; do NOT copy wording verbatim):
These examples are ONLY for guidance on structure and intent.
You MUST NOT reuse these replies as-is, and you MUST NOT copy their phrasing.
Write a fresh reply in your own words each time, and do not repeat wording found in RECENT_BOT_REPLIES.

Example A (advice/solution question):
User batch: "Why am I feeling lazy when I wake up?"
Good output:
{"replyText":"Got it. MeCove is for capturing what you're feeling rather than giving advice - what was your sleep like last night?","shouldGenerateSummary":false}

Example B (diagnosis/explanation question):
User batch: "What's wrong with me?"
Good output:
{"replyText":"I hear you. I can't diagnose, but we can capture what you're noticing here - what changed recently?","shouldGenerateSummary":false}

Example C (new topic, LAST_BOT_REPLY_WAS_QUESTION=false — ask a light question):
User batch: "I'm feeling very scared."
Good output:
{"replyText":"That sounds scary. What's going on right now?","shouldGenerateSummary":false}

Example C2 (user answering bot's question, LAST_BOT_REPLY_WAS_QUESTION=true — just acknowledge):
LAST_BOT_REPLY: "Bot: That sounds scary. What's going on right now?"
User batch: "I have an exam tomorrow and I haven't studied at all."
Good output:
{"replyText":"Got it. That's a lot of pressure.","shouldGenerateSummary":false}

Example C3 (routine journal entry, ack only — no question):
User batch: "Had a long day at work. Tired."
Good output:
{"replyText":"Got it.","shouldGenerateSummary":false}

Example E (repetition complaint):
User batch: "You keep saying the same thing."
Good output:
{"replyText":"You're right. Got it - if it helps, tell me what happened right before you started feeling this way.","shouldGenerateSummary":false}

Example F (safety — first time): User expresses self-harm; encourage help once.
Example G (safety — user continues talking about it): If RECENT_BOT_REPLIES already encouraged help, do NOT say "seek help" again; just reflect. e.g. User: "I still can't stop thinking about it." Good: {"replyText":"That's a lot to sit with.","shouldGenerateSummary":false} — reflect only. Occasionally (every few exchanges) add a brief reminder to reach out to someone or a helpline.

Example H2 (feedback about report, no request — shouldGenerateSummary false):
User batch: "Nice report but it's empty."
Good output:
{"replyText":"Got it. Tell me a bit more about what you expected to see in it.","shouldGenerateSummary":false}

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

function parseAckDecision(raw: string): { replyText: string; shouldGenerateSummary: boolean } {
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
    const parsed = JSON.parse(candidate) as Partial<AckDecision>;
    const replyText =
      typeof parsed.replyText === "string" && parsed.replyText.trim().length > 0
        ? parsed.replyText.trim()
        : FALLBACK_REPLY;
    const shouldGenerateSummary =
      parsed.shouldGenerateSummary === true || parsed.shouldGenerateReport === true;
    return { replyText, shouldGenerateSummary };
  } catch {
    // Fallback: if output looks like malformed JSON, do not leak it to the user.
    const looksLikeJsonLeak =
      trimmed.startsWith("{") ||
      trimmed.includes("```") ||
      /"replyText"\s*:|"shouldGenerateSummary"\s*:/.test(trimmed);

    if (looksLikeJsonLeak) {
      return { replyText: FALLBACK_REPLY, shouldGenerateSummary: false };
    }

    // Backward-compatible fallback: treat raw text as reply and do not trigger summary.
    return {
      replyText: trimmed.length > 0 ? trimmed : FALLBACK_REPLY,
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
 *
 * Two-stage flow:
 * 1. Cheap micro-classifier handles greeting/closing/trivial/summary_request directly.
 * 2. Full ACK_PROMPT only runs for "other" (complex/emotional/ambiguous) messages.
 */
export async function generateAckDecision(
  userId: string,
  freshMessageText: string,
  saveStatus: SaveStatus = "saved",
  options?: { isAdmin?: boolean }
): Promise<AckDecision> {
  // Stage 0: synchronous pre-filter — no LLM needed
  if (saveStatus === "save_failed") {
    return {
      replyText: "Your message could not be saved. Please try again in a bit.",
      shouldGenerateSummary: false,
    };
  }

  const recentMessages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: ACK_CONTEXT_FETCH_LIMIT,
    select: { text: true, createdAt: true, replyText: true, repliedAt: true, category: true },
  });

  const dek = await getOrCreateUserDek(userId);

  // Last ACK_CONTEXT_TARGET_COUNT (10) user messages, then reverse so oldest-first for the prompt
  const filteredRecent = recentMessages
    .filter((m) => m.category !== "test_feedback")
    .slice(0, ACK_CONTEXT_TARGET_COUNT);
  const oldestFirst = filteredRecent.reverse();

  // Decrypt text and replyText in place
  for (const m of oldestFirst) {
    if (m.text) m.text = decryptText(m.text, dek);
    if (m.replyText) m.replyText = decryptText(m.replyText, dek);
  }

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

  // Stage 1: micro-classifier — cheap call to handle simple cases without full history
  const classifier = await classifyMessage(freshMessageText, lastBotReplyWasQuestion);

  logger.info("ack reply", {
    model: modelName,
    ackPhrase,
    classifiedAs: classifier.type,
    historyMessageCount: oldestFirst.length,
    historyBotReplyCount: botLineCount,
    lastMessagesPreview:
      messagesBlock.length > 400
        ? `${messagesBlock.slice(0, 200)}...${messagesBlock.slice(-200)}`
        : messagesBlock,
  });

  // Route based on classifier result
  if (classifier.type === "greeting" || classifier.type === "closing") {
    return { replyText: classifier.replyText || FALLBACK_REPLY, shouldGenerateSummary: false };
  }

  if (classifier.type === "trivial") {
    return {
      replyText: swapAckPhrase(classifier.replyText || ackPhrase, ackPhrase),
      shouldGenerateSummary: false,
    };
  }

  if (classifier.type === "summary_request") {
    return { replyText: ackPhrase, shouldGenerateSummary: true };
  }

  if (classifier.type === "guide_query") {
    try {
      const guideReply = await generateGuideResponse(freshMessageText, options?.isAdmin ?? false);
      return { replyText: guideReply, shouldGenerateSummary: false };
    } catch (err) {
      logger.warn("guide reply generation failed, falling through to ACK_PROMPT", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall through to ACK_PROMPT
    }
  }

  // Stage 2: "other" — full ACK_PROMPT for complex/emotional/ambiguous messages
  const prompt = renderAckPrompt({
    saveStatus,
    messagesBlock,
    lastBotReply,
    lastBotReplyWasQuestion,
    recentBotReplies,
    batchedUserMessages: freshMessageText,
  });

  const reply = await llm.complete({
    prompt,
    maxTokens: 200,
    complexity: "low",
    reasoning: false,
  });

  const decision = parseAckDecision(reply);

  // Deterministic ack rotation: swap whatever ack the LLM used with our rotated phrase.
  // If the reply doesn't start with a known ack (safety, closing), leave it as-is.
  decision.replyText = swapAckPhrase(decision.replyText, ackPhrase);

  return decision;
}

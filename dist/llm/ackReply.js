"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAckDecision = generateAckDecision;
const prisma_1 = require("../infra/prisma");
const logger_1 = require("../infra/logger");
const testFeedback_1 = require("../messages/testFeedback");
const llmViaApi_1 = require("./llmViaApi");
const config_1 = require("./config");
// LLM for ack/reply and summary report generation. Uses unified YAML config (llm.yaml).
// Provider and model are selected by complexity/reasoning requirements.
const llm = new llmViaApi_1.LlmViaApi();
const ACK_PROMPT = `You are MeCove's WhatsApp reply engine.

You must output:
1) replyText: a short, human reply to the user's latest message batch
2) shouldGenerateSummary: a boolean for whether to generate a summary now

Inputs you will receive:
- SAVE_STATUS: "saved" | "save_failed"
- LAST_MESSAGES: recent conversation history (oldest first). "Bot:" lines are your prior replies.
- LAST_BOT_REPLY: the single most recent "Bot:" reply (or "(none)")
- RECENT_BOT_REPLIES: the 3 most recent "Bot:" replies (or "(none)")
- DISALLOWED_STARTS: normalized starters from recent Bot replies; your replyText MUST NOT start with these
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
Set shouldGenerateSummary = true whenever the user asks for a summary, report, or recap in any phrasing.
Examples: "summarize", "summary", "recap", "report", "generate my summary", "regenerate the summary", "I need my summary", "last 15 days summary", "past 15 days report", "can you generate my report", "send my summary", "give me my summary". The system will then generate and send the report; you do not need to say you cannot do it—set the flag true and your replyText will be replaced by a short "starting your summary" message.
Otherwise shouldGenerateSummary = false.

5) Core role and question-handling (semantic; use your own words):
MeCove is a lightweight journaling companion. It helps the user capture thoughts, feelings, and progress for later reflection.
MeCove does NOT provide coaching/therapy and does NOT give advice, solutions, or diagnosis.
Open space (follow-up questions): use only sparingly. For most messages, reply with a brief acknowledgment only—do not ask a question back.

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
- Your replyText MUST NOT start with anything in DISALLOWED_STARTS (or near-identical wording). If it would, rewrite it.

Default rule — open space sparingly:
- Most replies should be acknowledgment only (or ack + brief observation). Do NOT end with a question on every message.
- Do NOT ask a follow-up question in most replies. Default to leaving space without asking anything.

Ack (required):
- One short sentence acknowledging the user.
- Never use "Noted" or "Saved".
- Avoid generic filler validation like "That makes sense." unless you refer to something specific.

Observation (optional):
- Include only sometimes, when the batch is emotional/reflective.
- Reflection only (no advice, no diagnosis, no deep interpretation).
- Avoid canned reassurance like "It's okay to feel this way."

Open space (optional, use sparingly):
- Only occasionally: when the user seems stuck, has asked for advice/diagnosis (and you are redirecting), or has shared a lot without resolution. Not for routine journal entries or short updates.
- When you do use it: one gentle, non-pushy question only. Do not ask a question in most replies.

Special cases:
- Greetings: if the user only greets, reply with a greeting back (no open space).
- Closings: if the user is clearly closing ("bye", "good night", "gotta go"), reply politely and briefly (no open space).
- Repetition complaint: ONLY if the user explicitly complains about repetition ("you keep saying", "stop repeating", "same thing again"):
  - Start with "You're right." then write a fresh reply that does NOT start with DISALLOWED_STARTS and does NOT repeat RECENT_BOT_REPLIES.

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

Example C (emotional statement, no question):
User batch: "I'm feeling very scared."
Good output:
{"replyText":"Okay. That sounds scary.","shouldGenerateSummary":false}

Example C2 (routine journal entry, ack only — no question):
User batch: "Had a long day at work. Tired."
Good output:
{"replyText":"Got it.","shouldGenerateSummary":false}

Example D (greeting):
User batch: "gooooood morning"
Good output:
{"replyText":"Good morning.","shouldGenerateSummary":false}

Example E (repetition complaint):
User batch: "You keep saying the same thing."
Good output:
{"replyText":"You're right. Got it - if it helps, tell me what happened right before you started feeling this way.","shouldGenerateSummary":false}

Example F (safety — first time): User expresses self-harm; encourage help once.
Example G (safety — user continues talking about it): If RECENT_BOT_REPLIES already encouraged help, do NOT say "seek help" again; just reflect. e.g. User: "I still can't stop thinking about it." Good: {"replyText":"That's a lot to sit with.","shouldGenerateSummary":false} — reflect only. Occasionally (every few exchanges) add a brief reminder to reach out to someone or a helpline.

Example H (summary/report request — always set shouldGenerateSummary true): User asks for summary in any form (e.g. "regenerate the summary", "I need my summary for past 15 days", "generate my last 15 days summary report"). Good: set shouldGenerateSummary to true. ReplyText can be a brief ack; the system will replace it with a "starting your summary" message. e.g. {"replyText":"Got it.","shouldGenerateSummary":true}

Now produce the JSON.

SAVE_STATUS:
{{SAVE_STATUS}}

LAST_MESSAGES (oldest first):
{{MESSAGES}}

LAST_BOT_REPLY:
{{LAST_BOT_REPLY}}

RECENT_BOT_REPLIES:
{{RECENT_BOT_REPLIES}}

DISALLOWED_STARTS:
{{DISALLOWED_STARTS}}

BATCHED_USER_MESSAGES:
{{LATEST_USER_MESSAGE}}

Your JSON response:`;
const FALLBACK_REPLY = "Got it.";
const ACK_CONTEXT_TARGET_COUNT = 10;
const ACK_CONTEXT_FETCH_LIMIT = 30;
function parseAckDecision(raw) {
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
        const parsed = JSON.parse(candidate);
        const replyText = typeof parsed.replyText === "string" && parsed.replyText.trim().length > 0
            ? parsed.replyText.trim()
            : FALLBACK_REPLY;
        const shouldGenerateSummary = parsed.shouldGenerateSummary === true || parsed.shouldGenerateReport === true;
        return { replyText, shouldGenerateSummary };
    }
    catch {
        // Fallback: if output looks like malformed JSON, do not leak it to the user.
        const looksLikeJsonLeak = trimmed.startsWith("{") ||
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
function normalizeReplyStart(text) {
    const singleLine = text.replace(/\s+/g, " ").trim();
    if (singleLine.length === 0)
        return "";
    const punctIndex = singleLine.search(/[.!?]/);
    if (punctIndex >= 0) {
        const firstSentence = singleLine.slice(0, punctIndex + 1).trim();
        if (firstSentence.length >= 8 && firstSentence.length <= 120) {
            return firstSentence.toLowerCase();
        }
    }
    const words = singleLine.split(/\s+/).slice(0, 8).join(" ").trim();
    return words.toLowerCase();
}
function buildDisallowedStartsFromRecentBotReplies(recentBotReplies) {
    const rawLines = recentBotReplies
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    const starts = [];
    for (const line of rawLines) {
        const withoutPrefix = line.startsWith("Bot: ") ? line.slice("Bot: ".length) : line;
        const normalized = normalizeReplyStart(withoutPrefix);
        if (!normalized)
            continue;
        if (!starts.includes(normalized))
            starts.push(normalized);
    }
    return starts.length > 0 ? starts.join("\n") : "(none)";
}
function renderAckPrompt(params) {
    return ACK_PROMPT
        .split("{{SAVE_STATUS}}")
        .join(params.saveStatus)
        .split("{{MESSAGES}}")
        .join(params.messagesBlock)
        .split("{{LAST_BOT_REPLY}}")
        .join(params.lastBotReply)
        .split("{{RECENT_BOT_REPLIES}}")
        .join(params.recentBotReplies)
        .split("{{DISALLOWED_STARTS}}")
        .join(params.disallowedStarts)
        .split("{{LATEST_USER_MESSAGE}}")
        .join(params.batchedUserMessages);
}
/**
 * Fetches the last 10 messages for the user, passes them with the fresh message to the LLM,
 * and returns reply text + summary-generation intent.
 */
async function generateAckDecision(userId, freshMessageText, saveStatus = "saved") {
    const recentMessages = await prisma_1.prisma.message.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: ACK_CONTEXT_FETCH_LIMIT,
        select: { text: true, createdAt: true, replyText: true, repliedAt: true },
    });
    // Last ACK_CONTEXT_TARGET_COUNT (10) user messages, then reverse so oldest-first for the prompt
    const filteredRecent = recentMessages
        .filter((m) => !(0, testFeedback_1.isStoredTestFeedbackText)(m.text))
        .slice(0, ACK_CONTEXT_TARGET_COUNT);
    const oldestFirst = filteredRecent.reverse();
    // Format messages as alternating User/Bot pairs (oldest first) so the LLM sees chronology and its prior replies
    const lines = [];
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
    const recentBotReplies = botLines.length > 0 ? botLines.slice(Math.max(0, botLines.length - 3)).join("\n") : "(none)";
    const disallowedStarts = buildDisallowedStartsFromRecentBotReplies(recentBotReplies);
    let modelName = "unknown";
    try {
        const config = (0, config_1.loadLLMConfigForTask)({ complexity: "low", reasoning: false });
        modelName = `${config.provider}/${config.modelName}`;
    }
    catch {
        // ignore
    }
    logger_1.logger.info("ack reply", {
        model: modelName,
        historyMessageCount: oldestFirst.length,
        historyBotReplyCount: botLineCount,
        lastMessagesPreview: messagesBlock.length > 400
            ? `${messagesBlock.slice(0, 200)}...${messagesBlock.slice(-200)}`
            : messagesBlock,
    });
    const prompt = renderAckPrompt({
        saveStatus,
        messagesBlock,
        lastBotReply,
        recentBotReplies,
        disallowedStarts,
        batchedUserMessages: freshMessageText,
    });
    const reply = await llm.complete({
        prompt,
        maxTokens: 200,
        complexity: "low",
        reasoning: false,
    });
    return parseAckDecision(reply);
}

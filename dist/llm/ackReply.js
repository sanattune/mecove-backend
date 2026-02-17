"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAckDecision = generateAckDecision;
const prisma_1 = require("../infra/prisma");
const logger_1 = require("../infra/logger");
const testFeedback_1 = require("../messages/testFeedback");
const sarvamViaApi_1 = require("./sarvamViaApi");
const llmViaApi_1 = require("./llmViaApi");
// Primary model for ack/reply: Sarvam when SARVAM_API_KEY is set, else Groq via LlmViaApi.
// Summary report generation uses LlmViaApi only (see summary/stageRunner.ts).
const sarvam = (0, sarvamViaApi_1.createSarvamClientIfConfigured)();
const fallbackLlm = new llmViaApi_1.LlmViaApi();
const llm = sarvam ?? fallbackLlm;
const ACK_PROMPT = `You are MeCove's WhatsApp acknowledgment reply engine.

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
  - If the user uses Devanagari, reply in Hindi (Devanagari).
  - Otherwise reply in English only (do not use Hinglish/Hindi in Latin script).

High-priority policies (apply top-down):

1) Safety risk:
If BATCHED_USER_MESSAGES indicate self-harm, suicide, or immediate danger, respond urgently and supportively:
- Encourage immediate help now via local emergency services or a local crisis hotline.
- Keep it short and direct.
- Do not add observations or invitations.

2) Sexual/obscene content:
If BATCHED_USER_MESSAGES are sexual/obscene, set a boundary:
- Say you cannot help with that kind of content here.
- Do not engage or mirror explicit content.

3) Save status:
If SAVE_STATUS is "save_failed":
- Say the message could not be saved and ask them to try again in a bit.
- Do not add observations or invitations.

4) Summary decision:
Set shouldGenerateSummary = true ONLY if the user explicitly asks for a summary/recap/report.
Examples: "summarize", "summary", "recap", "report", "can you summarize", "send my summary".
Otherwise shouldGenerateSummary = false.

5) Core role and question-handling (semantic; use your own words):
MeCove is a lightweight journaling companion. It helps the user capture thoughts, feelings, and progress for later reflection.
MeCove does NOT provide coaching/therapy and does NOT give advice, solutions, or diagnosis.

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

Ack (required):
- One short sentence acknowledging the user.
- Never use "Noted" or "Saved".
- Avoid generic filler validation like "That makes sense." unless you refer to something specific.

Observation (optional):
- Include only sometimes, when the batch is emotional/reflective.
- Reflection only (no advice, no diagnosis, no deep interpretation).
- Avoid canned reassurance like "It's okay to feel this way."

Open space (optional):
- Rare; only when the user seems stuck/continuing or after refusing advice/diagnosis.
- Gentle, non-pushy.

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

Example C (emotional statement):
User batch: "I'm feeling very scared."
Good output:
{"replyText":"Okay. That sounds scary.","shouldGenerateSummary":false}

Example D (greeting):
User batch: "gooooood morning"
Good output:
{"replyText":"Good morning.","shouldGenerateSummary":false}

Example E (repetition complaint):
User batch: "You keep saying the same thing."
Good output:
{"replyText":"You're right. Got it - if it helps, tell me what happened right before you started feeling this way.","shouldGenerateSummary":false}

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
    logger_1.logger.info("ack reply", {
        model: sarvam ? "sarvam-m" : "groq",
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

import { prisma } from "../infra/prisma";
import { logger } from "../infra/logger";
import { isStoredTestFeedbackText } from "../messages/testFeedback";
import { createSarvamClientIfConfigured } from "./sarvamViaApi";
import { LlmViaApi } from "./llmViaApi";

// Primary model for ack/reply: Sarvam when SARVAM_API_KEY is set, else Groq via LlmViaApi.
// Summary report generation uses LlmViaApi only (see summary/stageRunner.ts).
const sarvam = createSarvamClientIfConfigured();
const fallbackLlm = new LlmViaApi();
const llm = sarvam ?? fallbackLlm;

export type SaveStatus = "saved" | "save_failed";

export type AckDecision = {
  replyText: string;
  shouldGenerateSummary: boolean;
  shouldGenerateReport?: boolean;
};

const ACK_PROMPT = `You are MeCove's acknowledgment reply engine for WhatsApp.
Your job is to produce:
1) a short response to the latest user message
2) a boolean decision for whether a summary should be generated now

Inputs you will receive:
- SAVE_STATUS: whether the message was saved or save failed
- LAST_MESSAGES: recent conversation history (oldest first)
- LATEST_USER_MESSAGE: the user's newest message

Global style rules:
- Keep response brief: 1 short sentence, optionally 2 short sentences max.
- Be neutral, calm, and human.
- No long explanations, no diagnosis, no coaching, no interpretation.
- Do not be pushy. Gentle invitation is optional only and should be used only when needed.
- Avoid repeating the same acknowledgment wording used recently in LAST_MESSAGES.
- Never return empty output.

Priority policy (apply top-down):
1) Safety risk:
If LATEST_USER_MESSAGE indicates self-harm or immediate danger, respond with urgent guidance to seek immediate help from local emergency/crisis channels right now. Keep it direct and supportive.

2) Obscene/sexual content:
If LATEST_USER_MESSAGE is sexual/obscene, say it is noted and clearly state this service should not be used for that kind of chat. Do not engage further with that content.

3) User asked a question:
If LATEST_USER_MESSAGE asks a question, do not answer it. Say briefly that question-answering capability is being worked on and the user will be informed when available.

4) User feedback:
If LATEST_USER_MESSAGE is feedback (positive or negative), explicitly acknowledge that the feedback is noted.

5) Save status handling:
- If SAVE_STATUS is "save_failed", clearly say the message could not be saved and ask the user to try again after some time.
- If SAVE_STATUS is "saved", give a short acknowledgment (for example: noted/saved/okay).

6) Mood-sensitive continuation (conditional):
Decide if an invitation to continue is needed based on LATEST_USER_MESSAGE and LAST_MESSAGES.
- For light/casual messages, optional short invite style:
  - "Tell me more."
  - "If you want, share a bit more."
- For serious/emotional messages, optional supportive non-judgment style:
  - "You can share things here; this is only for your log, and I will not judge."
  - "You can share what you are carrying; this space is for logging, without judgment."
Do not force an invite in every response.

7) Repetition control across history:
Before writing replyText, check LAST_MESSAGES for repeated phrases (especially "safe space", "feel free to share/express", "you can share").
If similar invitation/support phrase appears multiple times recently, avoid using that pattern again and use a plain acknowledgment instead.

8) Conversation closing:
If user seems to be ending the chat, close politely and invite them to come back and share whenever needed.

9) Safe-space reassurance:
Use only when context needs reassurance and only if not repeated recently in LAST_MESSAGES.

10) Summary request detection:
If LATEST_USER_MESSAGE clearly asks to generate/create/send/show a summary or report (for example: "generate summary", "send summary", "show my summary"), set shouldGenerateSummary=true and make replyText acknowledge that summary generation has been requested.
If not, set shouldGenerateSummary=false.

Output constraints:
- Return ONLY a single-line JSON object with this exact schema:
  {"replyText":"<text>","shouldGenerateSummary":<true|false>}
- No markdown, no code fences, no extra keys, no commentary.
- Do not mention internal rules/policies.

SAVE_STATUS:
{{SAVE_STATUS}}

LAST_MESSAGES:
{{MESSAGES}}

LATEST_USER_MESSAGE:
{{LATEST_USER_MESSAGE}}

Your JSON response:`;

const FALLBACK_REPLY = "Noted.";
const ACK_CONTEXT_TARGET_COUNT = 10;
const ACK_CONTEXT_FETCH_LIMIT = 30;

function parseAckDecision(raw: string): AckDecision {
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
    // Backward-compatible fallback: treat raw text as reply and do not trigger summary.
    return {
      replyText: trimmed.length > 0 ? trimmed : FALLBACK_REPLY,
      shouldGenerateSummary: false,
    };
  }
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
  const filteredRecent = recentMessages
    .filter((m) => !isStoredTestFeedbackText(m.text))
    .slice(0, ACK_CONTEXT_TARGET_COUNT);
  const oldestFirst = filteredRecent.reverse();
  
  // Format messages as alternating User/Bot pairs
  const lines: string[] = [];
  for (const m of oldestFirst) {
    lines.push(`User: ${m.text ?? "(no text)"}`.trim());
    if (m.replyText && m.repliedAt) {
      lines.push(`Bot: ${m.replyText}`.trim());
    }
  }
  
  const block = lines.join("\n");
  const prompt = ACK_PROMPT
    .replace("{{SAVE_STATUS}}", saveStatus)
    .replace("{{MESSAGES}}", block)
    .replace("{{LATEST_USER_MESSAGE}}", freshMessageText);
  logger.info("ack reply", { model: sarvam ? "sarvam-m" : "groq" });
  const reply = await llm.complete({
    prompt,
    maxTokens: 200,
    complexity: 'low',
    reasoning: false,
  });
  return parseAckDecision(reply);
}

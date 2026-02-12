import { prisma } from "../infra/prisma";
import { LlmViaApi } from "./llmViaApi";

const llm = new LlmViaApi();

export type SaveStatus = "saved" | "save_failed";

export type AckDecision = {
  replyText: string;
  shouldGenerateReport: boolean;
};

const ACK_PROMPT = `You are MeCove's acknowledgment reply engine for WhatsApp.
Your job is to produce:
1) a short response to the latest user message
2) a boolean decision for whether a report should be generated now

Inputs you will receive:
- SAVE_STATUS: whether the message was saved or save failed
- LAST_MESSAGES: recent conversation history (oldest first)
- LATEST_USER_MESSAGE: the user's newest message

Global style rules:
- Keep response brief: 1 short sentence, optionally 2 short sentences max.
- Be neutral, calm, and human.
- No long explanations, no diagnosis, no coaching, no interpretation.
- Do not be pushy. Gentle invitation is optional only.
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

6) Mood-sensitive gentle continuation:
When appropriate, softly invite the user to share more if they want. This should be occasional, not constant.

7) Conversation closing:
If user seems to be ending the chat, close politely and invite them to come back and share whenever needed.

8) Safe-space reassurance:
Occasionally include a brief reassurance that this is a safe space to share thoughts.

9) Report request detection:
If LATEST_USER_MESSAGE clearly asks to generate/create/send/show a report or summary (for example: "generate report", "send summary", "show my report"), set shouldGenerateReport=true and make replyText acknowledge that report generation has been requested.
If not, set shouldGenerateReport=false.

Output constraints:
- Return ONLY a single-line JSON object with this exact schema:
  {"replyText":"<text>","shouldGenerateReport":<true|false>}
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

function parseAckDecision(raw: string): AckDecision {
  const trimmed = raw.trim();
  let candidate = trimmed;

  // If model wraps JSON in a fenced block, extract inner content.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    candidate = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(candidate) as Partial<AckDecision>;
    const replyText =
      typeof parsed.replyText === "string" && parsed.replyText.trim().length > 0
        ? parsed.replyText.trim()
        : FALLBACK_REPLY;
    const shouldGenerateReport = parsed.shouldGenerateReport === true;
    return { replyText, shouldGenerateReport };
  } catch {
    // Backward-compatible fallback: treat raw text as reply and do not trigger report.
    return {
      replyText: trimmed.length > 0 ? trimmed : FALLBACK_REPLY,
      shouldGenerateReport: false,
    };
  }
}

/**
 * Fetches the last 10 messages for the user, passes them with the fresh message to the LLM,
 * and returns reply text + report-generation intent.
 */
export async function generateAckDecision(
  userId: string,
  freshMessageText: string,
  saveStatus: SaveStatus = "saved"
): Promise<AckDecision> {
  const messages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { text: true, createdAt: true, replyText: true, repliedAt: true },
  });
  const oldestFirst = messages.reverse();
  
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
  const reply = await llm.complete({
    prompt,
    maxTokens: 200,
  });
  return parseAckDecision(reply);
}

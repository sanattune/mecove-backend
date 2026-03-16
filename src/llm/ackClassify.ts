import { LlmViaApi } from "./llmViaApi";

const llm = new LlmViaApi();

export type ClassifyType = "greeting" | "closing" | "trivial" | "summary_request" | "other";

export type ClassifyResult = {
  type: ClassifyType;
  replyText: string;
};

const CLASSIFY_PROMPT = `You are a message classifier for a WhatsApp journaling app.

Classify the user's message into exactly one of these types:
- "greeting": user is greeting (hi, hello, good morning, hey, sup, namaste, etc.)
- "closing": user is signing off (bye, good night, gotta go, cya, see you, ttyl, etc.)
- "trivial": short routine/factual update with NO emotional weight ("had lunch", "at the gym", "going to bed"); also a brief factual answer to a prior bot question when LAST_BOT_REPLY_WAS_QUESTION is true
- "summary_request": user is explicitly requesting a summary/report/recap to be generated or sent now (any form: "summarize", "send my summary", "sessionbridge", "session bridge report", "give me my report", etc.)
- "other": everything else — use this as the default

Hard rules (strictly enforced):
- Default to "other" whenever uncertain. When in doubt, output "other".
- Any safety signal (self-harm, crisis, danger, suicide) → always "other".
- Any emotional or reflective content → always "other".
- Any advice-seeking or question-seeking from the user → always "other".
- Any obscene or sexual content → always "other".
- A message that combines emotional content with a summary request → always "other".
- Only classify as "trivial" if the message is genuinely brief and purely factual/routine.

For replyText:
- "greeting": natural greeting back in the user's language. No emojis. (e.g. "Good morning.", "Hello.", "Hey.")
- "closing": natural sign-off in the user's language. No emojis. (e.g. "Good night.", "Take care.", "Bye.")
- "trivial": a short ack phrase (e.g. "Got it.", "Noted.", "Heard."). No emojis. The caller will swap this for the rotated phrase.
- "summary_request": leave replyText as empty string "".
- "other": leave replyText as empty string "".

Output ONLY a single-line JSON object:
{"type":"<type>","replyText":"<text>"}
No markdown, no code fences, no extra keys, no commentary.

Inputs:
LAST_BOT_REPLY_WAS_QUESTION: {{LAST_BOT_REPLY_WAS_QUESTION}}
USER_MESSAGE: {{USER_MESSAGE}}

Your JSON response:`;

function parseClassifyResult(raw: string): ClassifyResult {
  const trimmed = raw.trim();
  let candidate = trimmed;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    candidate = fenceMatch[1].trim();
  }

  if (!(candidate.startsWith("{") && candidate.endsWith("}"))) {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  const VALID_TYPES: ClassifyType[] = ["greeting", "closing", "trivial", "summary_request", "other"];

  try {
    const parsed = JSON.parse(candidate) as Partial<{ type: string; replyText: string }>;
    const type: ClassifyType = VALID_TYPES.includes(parsed.type as ClassifyType)
      ? (parsed.type as ClassifyType)
      : "other";
    const replyText = typeof parsed.replyText === "string" ? parsed.replyText.trim() : "";
    return { type, replyText };
  } catch {
    return { type: "other", replyText: "" };
  }
}

export async function classifyMessage(
  freshMessageText: string,
  lastBotReplyWasQuestion: boolean
): Promise<ClassifyResult> {
  const prompt = CLASSIFY_PROMPT.split("{{LAST_BOT_REPLY_WAS_QUESTION}}")
    .join(String(lastBotReplyWasQuestion))
    .split("{{USER_MESSAGE}}")
    .join(freshMessageText);

  const raw = await llm.complete({
    prompt,
    maxTokens: 80,
    complexity: "low",
    reasoning: false,
  });

  return parseClassifyResult(raw);
}

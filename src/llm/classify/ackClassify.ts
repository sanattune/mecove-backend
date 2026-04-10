import { LlmViaApi } from "../llmViaApi";

const llm = new LlmViaApi();

export type ClassifyType = "greeting" | "closing" | "trivial" | "summary_request" | "guide_query" | "setup_checkin" | "other";

export type ClassifyResult = {
  type: ClassifyType;
  replyText: string;
};

const CLASSIFY_PROMPT = `You are a message classifier for a WhatsApp journaling app called MeCove.

Your job is to classify the user's latest message into exactly one of these types.
Use the RECENT_CONTEXT (last few exchanges) to understand the full intent — the same words can mean very different things depending on what came before.

Types:
- "greeting": the user is opening the conversation socially with no substantive content — any casual hello, opener, or social pleasantry in any language or phrasing. Includes things like "what's going on", "what's up", "how are things", "how are you", etc. when used as openers, not as expressions of distress.
- "closing": the user is wrapping up or signing off — any farewell, good night, or sign-off in any language or phrasing.
- "trivial": a brief, purely factual or routine update with absolutely no emotional weight and nothing to explore — the kind of thing someone logs in passing. Also includes a short, purely factual answer to the bot's prior question when LAST_BOT_REPLY_WAS_QUESTION is true AND the message carries no emotional weight whatsoever.
- "summary_request": the user is explicitly asking for a summary or report to be generated or sent now, in any phrasing.
- "guide_query": the user is asking how the tool works, what it can do, or what commands are available; OR expressing frustration or confusion specifically about the bot's behavior or purpose.
- "setup_checkin": the user wants to set up, change, or turn off a daily check-in reminder — any phrasing requesting automated reminders, scheduling a daily check-in, or managing reminder times. Hard rule: always classify as "setup_checkin" when the user asks to be reminded, set up a check-in, or change/cancel their reminder time.
- "other": default — use this for anything with emotional weight, reflective content, advice-seeking, ambiguity, or anything that doesn't clearly fit the above.

Hard rules (strictly enforced):
- Default to "other" whenever uncertain. When in doubt, output "other".
- Any safety signal (self-harm, crisis, danger, suicide) → always "other".
- Any emotional or reflective content → always "other", even if the message is short and even if LAST_BOT_REPLY_WAS_QUESTION is true. Emotional weight always overrides the question-answer heuristic.
- Any advice-seeking or question-seeking from the user → always "other".
- Any obscene or sexual content → always "other".
- A message that combines emotional content with a summary request → always "other".
- "greeting" only when the message is clearly a social opener with no substance — if RECENT_CONTEXT shows the user has been sharing something heavy, treat ambiguous openers as "other".

For replyText:
- "greeting": a natural greeting back in the user's language. No emojis. Match their register — casual if they're casual. Avoid time-specific phrases like "Good morning/evening/night". Vary naturally — these are illustrative only: "Hey.", "Hi there.", "Not much, what's on your mind?"
- "closing": a warm, time-neutral sign-off in the user's language. No emojis. Never use time-specific phrases like "Good night", "Good morning", "Good evening" — use neutral closings that work at any time of day. Match the user's reason for leaving: stepping away briefly → something like "Catch you later." or "Talk soon."; proper goodbye → something like "Take care." or "See you." Vary your phrasing naturally — these are illustrative only, do not reuse the same closing every time.
- "trivial": a short ack phrase (e.g. "Got it.", "Noted.", "Heard."). No emojis. The caller will swap this for the rotated phrase.
- "summary_request": leave replyText as empty string "".
- "guide_query": leave replyText as empty string "".
- "setup_checkin": leave replyText as empty string "".
- "other": leave replyText as empty string "".

Output ONLY a single-line JSON object:
{"type":"<type>","replyText":"<text>"}
No markdown, no code fences, no extra keys, no commentary.

Inputs:
LAST_BOT_REPLY_WAS_QUESTION: {{LAST_BOT_REPLY_WAS_QUESTION}}
RECENT_CONTEXT (last few exchanges, oldest first — empty if no prior conversation):
{{RECENT_CONTEXT}}
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

  const VALID_TYPES: ClassifyType[] = ["greeting", "closing", "trivial", "summary_request", "guide_query", "setup_checkin", "other"];

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
  lastBotReplyWasQuestion: boolean,
  recentContext?: string
): Promise<ClassifyResult> {
  const prompt = CLASSIFY_PROMPT.split("{{LAST_BOT_REPLY_WAS_QUESTION}}")
    .join(String(lastBotReplyWasQuestion))
    .split("{{RECENT_CONTEXT}}")
    .join(recentContext?.trim() || "(none)")
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

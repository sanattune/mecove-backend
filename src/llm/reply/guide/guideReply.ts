import { LlmViaApi } from "../../llmViaApi";
import { getFullGuide } from "../../../guides/content";

const llm = new LlmViaApi();

const FALLBACK_REPLY = "meCove is a listening space — type /guide to see how it works.";

const GUIDE_PROMPT = `You are meCove's guide assistant. The user has a question about how to use meCove, or is confused or frustrated with the tool.

Using the GUIDE_CONTENT below, write a helpful response that addresses the user's specific concern.

Rules:
- Maximum 4-5 lines. No more.
- Be warm, honest, and direct. No emojis. Do not be defensive or apologetic.
- If the user is wondering or questioning why meCove doesn't continue the chat or give advice: acknowledge their feeling briefly without naming any one, then explain that being non-chatty is an intentional design choice. meCove is a listening space, not a conversational app — we deliberately avoid engagement loops. Say this with compassion, not as a rejection.
- If the user is asking about commands or how to do something: list only the relevant commands or steps.
- Do not paste the entire guide. Extract only what is relevant to the user's message.
- meCove is not a therapist, coach, doctor, or crisis service — do not suggest it can provide those.
- Never use the word "journaling" or "journaling tool" — meCove is a listening space.
- Reply in the user's language when it is clearly not English; otherwise reply in English.
- Output ONLY the reply text. No JSON, no markdown code fences, no commentary.

GUIDE_CONTENT:
{{GUIDE_CONTENT}}

USER_MESSAGE:
{{USER_MESSAGE}}

Your reply:`;

export async function generateGuideResponse(
  userMessage: string,
  isAdmin: boolean
): Promise<string> {
  const guideContent = getFullGuide(isAdmin);
  const prompt = GUIDE_PROMPT
    .split("{{GUIDE_CONTENT}}")
    .join(guideContent)
    .split("{{USER_MESSAGE}}")
    .join(userMessage);

  const raw = await llm.complete({
    prompt,
    maxTokens: 300,
    complexity: "low",
    reasoning: false,
  });

  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("```")) {
    return FALLBACK_REPLY;
  }
  return trimmed;
}

import type { ILLMService, CompleteOptions } from "./types";
import { logger } from "../infra/logger";

const SARVAM_CHAT_URL = "https://api.sarvam.ai/v1/chat/completions";
const SARVAM_MODEL = "sarvam-m";

/**
 * LLM implementation that uses Sarvam AI chat completions API.
 * Used for primary response generation (e.g. ack replies). Not used for summary report generation.
 * Requires SARVAM_API_KEY in environment.
 */
export class SarvamViaApi implements ILLMService {
  private apiKey: string;

  constructor(apiKey?: string) {
    const key = (apiKey ?? process.env.SARVAM_API_KEY ?? "").trim();
    if (!key) {
      throw new Error("SarvamViaApi requires SARVAM_API_KEY to be set");
    }
    this.apiKey = key;
  }

  async complete(options: CompleteOptions): Promise<string> {
    const { prompt, maxTokens = 200 } = options;

    const res = await fetch(SARVAM_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SARVAM_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error("Sarvam API error", { status: res.status, body: text });
      throw new Error(`Sarvam API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null };
        finish_reason?: string;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    if (content == null || String(content).trim() === "") {
      const reason = choice?.finish_reason ?? "unknown";
      throw new Error(
        `Sarvam API returned empty content (finish_reason: ${reason}). Raw choice: ${JSON.stringify(choice)}`
      );
    }

    return String(content).trim();
  }
}

/**
 * Returns a SarvamViaApi instance if SARVAM_API_KEY is set, otherwise null.
 */
export function createSarvamClientIfConfigured(): SarvamViaApi | null {
  const key = (process.env.SARVAM_API_KEY ?? "").trim();
  if (!key) return null;
  try {
    return new SarvamViaApi(key);
  } catch {
    return null;
  }
}

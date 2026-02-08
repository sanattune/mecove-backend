import type { ILLMService, CompleteOptions, ResolvedModelConfig } from "./types";
import { loadLLMConfig } from "./config";

const GROQ_BASE = "https://api.groq.com/openai/v1";

/**
 * LLM implementation that calls the configured provider's API (e.g. Groq) for completions.
 * Config is read from config/llm.yaml; api_key is resolved from env.
 */
export class LlmViaApi implements ILLMService {
  private config: ResolvedModelConfig;

  constructor(config?: ResolvedModelConfig) {
    this.config = config ?? loadLLMConfig();
  }

  async complete(options: CompleteOptions): Promise<string> {
    const { prompt, maxTokens } = options;
    const { provider, modelName, apiKey, maxTokens: configMax } = this.config;
    const max = maxTokens ?? configMax;

    if (provider === "groq") {
      return this.groqComplete(modelName, apiKey, prompt, max);
    }
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  private async groqComplete(
    model: string,
    apiKey: string,
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    const url = `${GROQ_BASE}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq API error ${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null };
        finish_reason?: string;
      }>;
    };
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    if (content == null || String(content).trim() === "") {
      const reason = choice?.finish_reason ?? "unknown";
      throw new Error(
        `Groq API returned empty content (finish_reason: ${reason}). Raw choice: ${JSON.stringify(choice)}`
      );
    }
    return content;
  }
}

import type { ILLMService, CompleteOptions, ResolvedModelConfig } from "./types";
import { loadLLMConfig, loadLLMConfigForTask } from "./config";
import { logger } from "../infra/logger";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const OPENAI_BASE = "https://api.openai.com/v1";

/**
 * LLM implementation that calls the configured provider's API (e.g. Groq) for completions.
 * Config is read from config/llm.yaml; api_key is resolved from env.
 * Model selection is dynamic based on complexity and reasoning requirements in CompleteOptions.
 */
export class LlmViaApi implements ILLMService {
  private defaultConfig: ResolvedModelConfig;

  constructor(config?: ResolvedModelConfig) {
    this.defaultConfig = config ?? loadLLMConfig();
  }

  async complete(options: CompleteOptions): Promise<string> {
    const { prompt, maxTokens, complexity, reasoning } = options;
    
    // Select model dynamically based on task requirements
    const config = complexity !== undefined || reasoning !== undefined
      ? loadLLMConfigForTask({ complexity, reasoning })
      : this.defaultConfig;
    
    const { provider, modelName, apiKey, maxTokens: configMax } = config;
    const max = maxTokens ?? configMax;

    if (provider === "groq") {
      return this.groqComplete(modelName, apiKey, prompt, max);
    }
    if (provider === "openai") {
      return this.openaiComplete(modelName, apiKey, prompt, max);
    }
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  private async groqComplete(
    model: string,
    apiKey: string,
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    const callGroq = async (tokens: number) => {
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
          max_tokens: tokens,
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
          [key: string]: unknown;
        }>;
        [key: string]: unknown;
      };
      return data;
    };

    const extractContent = (
      data: {
        choices?: Array<{
          message?: { content?: string | null };
          finish_reason?: string;
          [key: string]: unknown;
        }>;
      },
      tokenBudget: number
    ): string => {
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      if (content == null || String(content).trim() === "") {
        const reason = choice?.finish_reason ?? "unknown";
        throw new Error(
          `Groq API returned empty content (finish_reason: ${reason}, max_tokens: ${tokenBudget}). Raw choice: ${JSON.stringify(choice)}`
        );
      }
      return content;
    };

    const first = await callGroq(maxTokens);
    try {
      return extractContent(first, maxTokens);
    } catch (err) {
      const firstChoice = first.choices?.[0];
      const firstReason = firstChoice?.finish_reason ?? "unknown";

      // Some reasoning models can consume the generation budget and return empty content with finish_reason=length.
      // Retry once with a larger completion budget before failing.
      if (firstReason === "length") {
        const retryTokens = Math.max(maxTokens * 4, 512);
        logger.warn("empty Groq content with finish_reason=length, retrying with larger max_tokens", {
          model,
          firstMaxTokens: maxTokens,
          retryMaxTokens: retryTokens,
          rawChoice: firstChoice,
        });
        const second = await callGroq(retryTokens);
        try {
          return extractContent(second, retryTokens);
        } catch (retryErr) {
          logger.error("Groq completion failed after retry", {
            model,
            firstMaxTokens: maxTokens,
            retryMaxTokens: retryTokens,
            firstRaw: first,
            retryRaw: second,
          });
          throw retryErr;
        }
      }

      logger.error("Groq completion failed", {
        model,
        maxTokens,
        raw: first,
      });
      throw err;
    }
  }

  private async openaiComplete(
    model: string,
    apiKey: string,
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    // Debug: Log key info (first 10 and last 10 chars only for security)
    const keyPreview = apiKey.length > 20 
      ? `${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 10)}`
      : `${apiKey.substring(0, Math.min(10, apiKey.length))}...`;
    logger.info("OpenAI API call", { 
      model, 
      keyLength: apiKey.length,
      keyPreview,
      keyStartsWith: apiKey.substring(0, 7),
      keyEndsWith: apiKey.substring(Math.max(0, apiKey.length - 10))
    });

    const callOpenAI = async (tokens: number) => {
      const url = `${OPENAI_BASE}/chat/completions`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: tokens,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        logger.error("OpenAI API error", { status: res.status, body: text });
        throw new Error(`OpenAI API error ${res.status}: ${text}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{
          message?: { content?: string | null };
          finish_reason?: string;
          [key: string]: unknown;
        }>;
        [key: string]: unknown;
      };
      return data;
    };

    const extractContent = (
      data: {
        choices?: Array<{
          message?: { content?: string | null };
          finish_reason?: string;
          [key: string]: unknown;
        }>;
      },
      tokenBudget: number
    ): string => {
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      if (content == null || String(content).trim() === "") {
        const reason = choice?.finish_reason ?? "unknown";
        throw new Error(
          `OpenAI API returned empty content (finish_reason: ${reason}, max_tokens: ${tokenBudget}). Raw choice: ${JSON.stringify(choice)}`
        );
      }
      return content;
    };

    const first = await callOpenAI(maxTokens);
    try {
      return extractContent(first, maxTokens);
    } catch (err) {
      const firstChoice = first.choices?.[0];
      const firstReason = firstChoice?.finish_reason ?? "unknown";

      // Some reasoning models can consume the generation budget and return empty content with finish_reason=length.
      // Retry once with a larger completion budget before failing.
      if (firstReason === "length") {
        const retryTokens = Math.max(maxTokens * 4, 512);
        logger.warn("empty OpenAI content with finish_reason=length, retrying with larger max_tokens", {
          model,
          firstMaxTokens: maxTokens,
          retryMaxTokens: retryTokens,
          rawChoice: firstChoice,
        });
        const second = await callOpenAI(retryTokens);
        try {
          return extractContent(second, retryTokens);
        } catch (retryErr) {
          logger.error("OpenAI completion failed after retry", {
            model,
            firstMaxTokens: maxTokens,
            retryMaxTokens: retryTokens,
            firstRaw: first,
            retryRaw: second,
          });
          throw retryErr;
        }
      }

      logger.error("OpenAI completion failed", {
        model,
        maxTokens,
        raw: first,
      });
      throw err;
    }
  }
}

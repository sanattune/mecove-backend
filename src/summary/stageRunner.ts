import { logger } from "../infra/logger";
import { LlmViaApi } from "../llm/llmViaApi";

export class SummaryStageError extends Error {
  stage: string;
  rawSnippet: string;

  constructor(stage: string, message: string, rawResponse?: string) {
    const snippet = (rawResponse ?? "").slice(0, 400);
    super(`[${stage}] ${message}${snippet ? ` | raw: ${snippet}` : ""}`);
    this.stage = stage;
    this.rawSnippet = snippet;
  }
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }
  return trimmed;
}

type RunJsonStageOptions<T> = {
  stage: string;
  prompt: string;
  maxTokens: number;
  validate: (value: unknown) => value is T;
  llm?: LlmViaApi;
};

export async function runJsonStage<T>(options: RunJsonStageOptions<T>): Promise<T> {
  const llm = options.llm ?? new LlmViaApi();
  let lastRaw = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now();
    const raw = await llm.complete({
      prompt: options.prompt,
      maxTokens: options.maxTokens,
    });
    lastRaw = raw;
    const latencyMs = Date.now() - startedAt;

    logger.info("summary stage completed", {
      stage: options.stage,
      attempt: attempt + 1,
      latencyMs,
      empty: raw.trim().length === 0,
    });

    if (!raw || raw.trim().length === 0) {
      if (attempt === 0) continue;
      throw new SummaryStageError(options.stage, "Empty LLM output", raw);
    }

    try {
      const candidate = extractJsonCandidate(raw);
      const parsed = JSON.parse(candidate) as unknown;
      if (!options.validate(parsed)) {
        if (attempt === 0) continue;
        throw new SummaryStageError(options.stage, "JSON schema validation failed", raw);
      }
      return parsed;
    } catch (err) {
      if (attempt === 0) continue;
      if (err instanceof SummaryStageError) throw err;
      throw new SummaryStageError(
        options.stage,
        err instanceof Error ? err.message : "Invalid JSON",
        raw
      );
    }
  }

  throw new SummaryStageError(options.stage, "Stage failed after retries", lastRaw);
}


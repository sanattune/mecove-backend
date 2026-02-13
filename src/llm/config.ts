import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { ResolvedModelConfig } from "./types";

type RawModel = {
  name: string;
  complexity?: string[];
  reasoning?: boolean;
  tasks?: string[];
  cost_per_1m_tokens?: number;
  max_tokens: number;
};

type RawProvider = {
  api_key: string;
  models: RawModel[];
};

type RawConfig = {
  providers?: Record<string, RawProvider>;
};

/** Resolve ${VAR} and ${VAR:-default} from process.env */
function resolveEnv(value: string): string {
  return value.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, key, def) => {
    const v = process.env[key];
    return v !== undefined && v !== "" ? v : (def ?? "");
  });
}

function loadRawConfig(configPath: string): RawConfig {
  const content = readFileSync(configPath, "utf8");
  return parse(content) as RawConfig;
}

/**
 * Load LLM config from YAML and return the first available model (for backward compatibility).
 * api_key in config is resolved from env (e.g. ${GROQ_API_KEY}).
 */
const defaultConfigPath = join(__dirname, "llm.yaml");

/**
 * Select a model based on complexity and reasoning requirements.
 * Selection algorithm:
 * 1. Filter models by provider (with valid API key)
 * 2. If reasoning=true: filter to models with reasoning=true, then match complexity if specified
 * 3. If reasoning=false or not specified: filter to models with reasoning=false, then match complexity if specified
 * 4. Fallback: first available model
 */
export function loadLLMConfigForTask(
  options: {
    complexity?: 'low' | 'medium' | 'high';
    reasoning?: boolean;
  } = {},
  configPath?: string
): ResolvedModelConfig {
  const path = configPath ?? defaultConfigPath;
  const raw = loadRawConfig(path);
  const providers = raw.providers ?? {};
  const { complexity, reasoning } = options;

  // Find provider with valid API key
  for (const [providerName, provider] of Object.entries(providers)) {
    const rawKey = (provider as RawProvider).api_key ?? "";
    const apiKey = resolveEnv(String(rawKey)).trim();
    if (!apiKey) continue;

    const models = (provider as RawProvider).models ?? [];
    let candidates: RawModel[] = [];

    // Step 1: Filter by reasoning requirement
    if (reasoning === true) {
      candidates = models.filter((m) => m.reasoning === true);
    } else if (reasoning === false) {
      candidates = models.filter((m) => m.reasoning !== true);
    } else {
      // reasoning not specified, consider all models
      candidates = models;
    }

    // Step 2: Filter by complexity if specified
    if (complexity && candidates.length > 0) {
      const complexityFiltered = candidates.filter((m) => {
        const complexities = m.complexity ?? [];
        return complexities.includes(complexity);
      });
      // If we found matches for complexity, use those; otherwise keep original candidates
      if (complexityFiltered.length > 0) {
        candidates = complexityFiltered;
      }
    }

    // Step 3: Select first available model from candidates
    if (candidates.length > 0) {
      const model = candidates[0];
      if (model?.name) {
        return {
          provider: providerName,
          modelName: model.name,
          apiKey,
          maxTokens: model.max_tokens ?? 4096,
        };
      }
    }

    // Step 4: Fallback to first available model if no match found
    if (models.length > 0 && models[0]?.name) {
      return {
        provider: providerName,
        modelName: models[0].name,
        apiKey,
        maxTokens: models[0].max_tokens ?? 4096,
      };
    }
  }

  throw new Error("No LLM provider with api_key and at least one model found in llm.yaml");
}

/**
 * Load LLM config from YAML and return the first available model (for backward compatibility).
 * api_key in config is resolved from env (e.g. ${GROQ_API_KEY}).
 */
export function loadLLMConfig(configPath?: string): ResolvedModelConfig {
  return loadLLMConfigForTask({}, configPath);
}

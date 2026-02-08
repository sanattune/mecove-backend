import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { ResolvedModelConfig } from "./types";

type RawModel = {
  name: string;
  complexity?: string[];
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
 * Load LLM config from YAML and return the first available model (for now: one provider, one model).
 * api_key in config is resolved from env (e.g. ${GROQ_API_KEY}).
 */
const defaultConfigPath = join(__dirname, "llm.yaml");

export function loadLLMConfig(configPath?: string): ResolvedModelConfig {
  const path = configPath ?? defaultConfigPath;
  const raw = loadRawConfig(path);
  const providers = raw.providers ?? {};
  for (const [providerName, provider] of Object.entries(providers)) {
    const rawKey = (provider as RawProvider).api_key ?? "";
    const apiKey = resolveEnv(String(rawKey)).trim();
    if (!apiKey) continue;
    const models = (provider as RawProvider).models ?? [];
    const model = models[0];
    if (!model?.name) continue;
    return {
      provider: providerName,
      modelName: model.name,
      apiKey,
      maxTokens: model.max_tokens ?? 4096,
    };
  }
  throw new Error("No LLM provider with api_key and at least one model found in llm.yaml");
}

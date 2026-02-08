"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadLLMConfig = loadLLMConfig;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const yaml_1 = require("yaml");
/** Resolve ${VAR} and ${VAR:-default} from process.env */
function resolveEnv(value) {
    return value.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, key, def) => {
        const v = process.env[key];
        return v !== undefined && v !== "" ? v : (def ?? "");
    });
}
function loadRawConfig(configPath) {
    const content = (0, node_fs_1.readFileSync)(configPath, "utf8");
    return (0, yaml_1.parse)(content);
}
/**
 * Load LLM config from YAML and return the first available model (for now: one provider, one model).
 * api_key in config is resolved from env (e.g. ${GROQ_API_KEY}).
 */
const defaultConfigPath = (0, node_path_1.join)(__dirname, "llm.yaml");
function loadLLMConfig(configPath) {
    const path = configPath ?? defaultConfigPath;
    const raw = loadRawConfig(path);
    const providers = raw.providers ?? {};
    for (const [providerName, provider] of Object.entries(providers)) {
        const rawKey = provider.api_key ?? "";
        const apiKey = resolveEnv(String(rawKey)).trim();
        if (!apiKey)
            continue;
        const models = provider.models ?? [];
        const model = models[0];
        if (!model?.name)
            continue;
        return {
            provider: providerName,
            modelName: model.name,
            apiKey,
            maxTokens: model.max_tokens ?? 4096,
        };
    }
    throw new Error("No LLM provider with api_key and at least one model found in config (e.g. config/llm.yaml)");
}

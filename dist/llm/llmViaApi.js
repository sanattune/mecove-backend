"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmViaApi = void 0;
const config_1 = require("./config");
const GROQ_BASE = "https://api.groq.com/openai/v1";
/**
 * LLM implementation that calls the configured provider's API (e.g. Groq) for completions.
 * Config is read from config/llm.yaml; api_key is resolved from env.
 */
class LlmViaApi {
    config;
    constructor(config) {
        this.config = config ?? (0, config_1.loadLLMConfig)();
    }
    async complete(options) {
        const { prompt, maxTokens } = options;
        const { provider, modelName, apiKey, maxTokens: configMax } = this.config;
        const max = maxTokens ?? configMax;
        if (provider === "groq") {
            return this.groqComplete(modelName, apiKey, prompt, max);
        }
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
    async groqComplete(model, apiKey, prompt, maxTokens) {
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
        const data = (await res.json());
        const choice = data.choices?.[0];
        const content = choice?.message?.content;
        if (content == null || String(content).trim() === "") {
            const reason = choice?.finish_reason ?? "unknown";
            throw new Error(`Groq API returned empty content (finish_reason: ${reason}). Raw choice: ${JSON.stringify(choice)}`);
        }
        return content;
    }
}
exports.LlmViaApi = LlmViaApi;

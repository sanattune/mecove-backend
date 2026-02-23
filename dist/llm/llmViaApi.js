"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmViaApi = void 0;
const config_1 = require("./config");
const logger_1 = require("../infra/logger");
const GROQ_BASE = "https://api.groq.com/openai/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const SARVAM_BASE = "https://api.sarvam.ai/v1";
/**
 * LLM implementation that calls the configured provider's API (e.g. Groq) for completions.
 * Config is read from config/llm.yaml; api_key is resolved from env.
 * Model selection is dynamic based on complexity and reasoning requirements in CompleteOptions.
 */
class LlmViaApi {
    defaultConfig;
    constructor(config) {
        this.defaultConfig = config ?? (0, config_1.loadLLMConfig)();
    }
    async complete(options) {
        const { prompt, maxTokens, complexity, reasoning } = options;
        // Select model dynamically based on task requirements
        const config = complexity !== undefined || reasoning !== undefined
            ? (0, config_1.loadLLMConfigForTask)({ complexity, reasoning })
            : this.defaultConfig;
        const { provider, modelName, apiKey, maxTokens: configMax } = config;
        const max = maxTokens ?? configMax;
        if (provider === "groq") {
            return this.groqComplete(modelName, apiKey, prompt, max);
        }
        if (provider === "openai") {
            return this.openaiComplete(modelName, apiKey, prompt, max);
        }
        if (provider === "sarvam") {
            return this.sarvamComplete(modelName, apiKey, prompt, max);
        }
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
    async groqComplete(model, apiKey, prompt, maxTokens) {
        const callGroq = async (tokens) => {
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
            const data = (await res.json());
            return data;
        };
        const extractContent = (data, tokenBudget) => {
            const choice = data.choices?.[0];
            const content = choice?.message?.content;
            if (content == null || String(content).trim() === "") {
                const reason = choice?.finish_reason ?? "unknown";
                throw new Error(`Groq API returned empty content (finish_reason: ${reason}, max_tokens: ${tokenBudget}). Raw choice: ${JSON.stringify(choice)}`);
            }
            return content;
        };
        const first = await callGroq(maxTokens);
        try {
            return extractContent(first, maxTokens);
        }
        catch (err) {
            const firstChoice = first.choices?.[0];
            const firstReason = firstChoice?.finish_reason ?? "unknown";
            // Some reasoning models can consume the generation budget and return empty content with finish_reason=length.
            // Retry once with a larger completion budget before failing.
            if (firstReason === "length") {
                const retryTokens = Math.max(maxTokens * 4, 512);
                logger_1.logger.warn("empty Groq content with finish_reason=length, retrying with larger max_tokens", {
                    model,
                    firstMaxTokens: maxTokens,
                    retryMaxTokens: retryTokens,
                    rawChoice: firstChoice,
                });
                const second = await callGroq(retryTokens);
                try {
                    return extractContent(second, retryTokens);
                }
                catch (retryErr) {
                    logger_1.logger.error("Groq completion failed after retry", {
                        model,
                        firstMaxTokens: maxTokens,
                        retryMaxTokens: retryTokens,
                        firstRaw: first,
                        retryRaw: second,
                    });
                    throw retryErr;
                }
            }
            logger_1.logger.error("Groq completion failed", {
                model,
                maxTokens,
                raw: first,
            });
            throw err;
        }
    }
    async openaiComplete(model, apiKey, prompt, maxTokens) {
        const callOpenAI = async (tokens) => {
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
                logger_1.logger.error("OpenAI API error", { status: res.status, body: text });
                throw new Error(`OpenAI API error ${res.status}: ${text}`);
            }
            const data = (await res.json());
            return data;
        };
        const extractContent = (data, tokenBudget) => {
            const choice = data.choices?.[0];
            const content = choice?.message?.content;
            if (content == null || String(content).trim() === "") {
                const reason = choice?.finish_reason ?? "unknown";
                throw new Error(`OpenAI API returned empty content (finish_reason: ${reason}, max_tokens: ${tokenBudget}). Raw choice: ${JSON.stringify(choice)}`);
            }
            return content;
        };
        const first = await callOpenAI(maxTokens);
        try {
            return extractContent(first, maxTokens);
        }
        catch (err) {
            const firstChoice = first.choices?.[0];
            const firstReason = firstChoice?.finish_reason ?? "unknown";
            if (firstReason === "length") {
                const retryTokens = Math.max(maxTokens * 4, 512);
                logger_1.logger.warn("empty OpenAI content with finish_reason=length, retrying with larger max_tokens", {
                    model,
                    firstMaxTokens: maxTokens,
                    retryMaxTokens: retryTokens,
                    rawChoice: firstChoice,
                });
                const second = await callOpenAI(retryTokens);
                try {
                    return extractContent(second, retryTokens);
                }
                catch (retryErr) {
                    logger_1.logger.error("OpenAI completion failed after retry", {
                        model,
                        firstMaxTokens: maxTokens,
                        retryMaxTokens: retryTokens,
                        firstRaw: first,
                        retryRaw: second,
                    });
                    throw retryErr;
                }
            }
            logger_1.logger.error("OpenAI completion failed", {
                model,
                maxTokens,
                raw: first,
            });
            throw err;
        }
    }
    async sarvamComplete(model, apiKey, prompt, maxTokens) {
        const url = `${SARVAM_BASE}/chat/completions`;
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
            logger_1.logger.error("Sarvam API error", { status: res.status, body: text });
            throw new Error(`Sarvam API error ${res.status}: ${text}`);
        }
        const data = (await res.json());
        const choice = data.choices?.[0];
        const content = choice?.message?.content;
        if (content == null || String(content).trim() === "") {
            const reason = choice?.finish_reason ?? "unknown";
            throw new Error(`Sarvam API returned empty content (finish_reason: ${reason}). Raw choice: ${JSON.stringify(choice)}`);
        }
        return String(content).trim();
    }
}
exports.LlmViaApi = LlmViaApi;

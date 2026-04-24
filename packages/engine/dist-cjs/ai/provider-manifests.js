"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_PROVIDER_MANIFESTS_ENV = void 0;
exports.loadConfiguredAIProviderManifests = loadConfiguredAIProviderManifests;
exports.createConfiguredAIProvider = createConfiguredAIProvider;
const openai_1 = __importDefault(require("openai"));
const logger_1 = require("../observability/logger");
exports.AI_PROVIDER_MANIFESTS_ENV = "CEOCLAW_AI_PROVIDER_MANIFESTS";
function tryParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return undefined;
    }
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
function normalizeProviderManifest(value, index) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        logger_1.logger.warn("Skipping invalid AI provider manifest entry", {
            index,
            reason: "not an object",
        });
        return null;
    }
    const record = value;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const baseURL = typeof record.baseURL === "string" ? record.baseURL.trim() : "";
    const apiKeyEnvVar = typeof record.apiKeyEnvVar === "string" ? record.apiKeyEnvVar.trim() : "";
    const defaultModel = typeof record.defaultModel === "string" ? record.defaultModel.trim() : "";
    const models = normalizeStringArray(record.models);
    const displayName = typeof record.displayName === "string" ? record.displayName.trim() : undefined;
    const description = typeof record.description === "string" ? record.description.trim() : undefined;
    const timeoutMs = typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs)
        ? record.timeoutMs
        : undefined;
    if (!name || !baseURL || !apiKeyEnvVar || !defaultModel) {
        logger_1.logger.warn("Skipping invalid AI provider manifest entry", {
            index,
            name: name || null,
            reason: "missing required fields",
        });
        return null;
    }
    return {
        name,
        baseURL,
        apiKeyEnvVar,
        defaultModel,
        models: models.length > 0 ? models : [defaultModel],
        displayName,
        description,
        timeoutMs,
    };
}
function loadConfiguredAIProviderManifests(env = process.env) {
    const raw = env[exports.AI_PROVIDER_MANIFESTS_ENV];
    if (!raw?.trim()) {
        return [];
    }
    const parsed = tryParseJson(raw);
    if (!Array.isArray(parsed)) {
        logger_1.logger.warn("AI provider manifests must be a JSON array", {
            envVar: exports.AI_PROVIDER_MANIFESTS_ENV,
        });
        return [];
    }
    return parsed
        .map((item, index) => normalizeProviderManifest(item, index))
        .filter((item) => Boolean(item));
}
function createConfiguredAIProvider(manifest, env = process.env) {
    const getApiKey = () => env[manifest.apiKeyEnvVar]?.trim() || "";
    return {
        name: manifest.name,
        models: manifest.models ?? [manifest.defaultModel],
        async chat(messages, options) {
            const apiKey = getApiKey();
            if (!apiKey) {
                throw new Error(`${manifest.apiKeyEnvVar} not set`);
            }
            const client = new openai_1.default({
                apiKey,
                baseURL: manifest.baseURL,
                timeout: manifest.timeoutMs ?? 30000,
            });
            const response = await client.chat.completions.create({
                model: options?.model || manifest.defaultModel,
                messages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens ?? 4096,
            });
            return response.choices[0]?.message?.content ?? "";
        },
        async *chatStream(messages, options) {
            const apiKey = getApiKey();
            if (!apiKey) {
                throw new Error(`${manifest.apiKeyEnvVar} not set`);
            }
            const client = new openai_1.default({
                apiKey,
                baseURL: manifest.baseURL,
                timeout: manifest.timeoutMs ?? 30000,
            });
            const stream = await client.chat.completions.create({
                model: options?.model || manifest.defaultModel,
                messages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.maxTokens ?? 4096,
                stream: true,
            });
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    yield content;
                }
            }
        },
    };
}

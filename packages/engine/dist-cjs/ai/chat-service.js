"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestAIChatCompletion = requestAIChatCompletion;
exports.createAIChatStream = createAIChatStream;
require("server-only");
const chat_store_1 = require("./chat-store");
const PROVIDER_TIMEOUT_MS = 30000;
function createTimeoutSignal(timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return {
        signal: controller.signal,
        cleanup: () => clearTimeout(timeoutId),
    };
}
function buildProviderHeaders(provider, apiKey) {
    const headers = {
        "Content-Type": "application/json",
    };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    if (provider === "openrouter") {
        headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_APP_URL || "https://ceoclaw.com";
        headers["X-Title"] = "CEOClaw";
    }
    return headers;
}
function resolveModel(provider, selectedProvider, selectedModel, fallbackModel) {
    if (selectedProvider === provider && selectedModel && selectedModel.trim().length > 0) {
        return selectedModel.trim();
    }
    return fallbackModel;
}
function parseCompletionResponse(data, provider, model) {
    const choice = data.choices?.[0];
    const message = choice?.message;
    if (!message) {
        return null;
    }
    const content = message.content ?? null;
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : undefined;
    if (!content && (!toolCalls || toolCalls.length === 0)) {
        return null;
    }
    return {
        provider,
        model,
        content,
        toolCalls,
    };
}
async function fetchCompletion(provider, input) {
    const requestBody = {
        model: input.model,
        messages: input.messages,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
    };
    if (input.tools && input.tools.length > 0) {
        requestBody.tools = input.tools;
        requestBody.tool_choice = "auto";
    }
    const { signal, cleanup } = createTimeoutSignal(PROVIDER_TIMEOUT_MS);
    try {
        const response = await fetch(input.baseUrl, {
            method: "POST",
            headers: buildProviderHeaders(provider, input.apiKey),
            body: JSON.stringify(requestBody),
            signal,
        });
        if (!response.ok) {
            throw new Error(`${provider} error: ${response.status} - ${await response.text()}`);
        }
        return (await response.json());
    }
    finally {
        cleanup();
    }
}
async function requestAIChatCompletion(input) {
    const maxTokens = input.maxTokens ?? 1200;
    const temperature = input.temperature ?? 0.4;
    const selectedProvider = input.providerOrder[0];
    let lastError = null;
    for (const provider of input.providerOrder) {
        const config = await (0, chat_store_1.resolveChatProviderConfig)(provider);
        if (!config.enabled) {
            continue;
        }
        if (provider !== "local" && !config.apiKey) {
            continue;
        }
        const model = resolveModel(provider, selectedProvider, input.model, config.defaultModel);
        try {
            const data = await fetchCompletion(provider, {
                apiKey: config.apiKey,
                baseUrl: config.baseUrl,
                maxTokens,
                messages: input.messages,
                model,
                temperature,
                tools: input.tools,
            });
            const result = parseCompletionResponse(data, provider, model);
            if (result) {
                return result;
            }
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }
    throw lastError ?? new Error("No AI provider is currently available.");
}
async function* consumeSseResponse(response) {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("Provider returned an empty SSE body.");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) {
                continue;
            }
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") {
                continue;
            }
            try {
                const data = JSON.parse(payload);
                const content = data.choices?.[0]?.delta?.content;
                if (content) {
                    yield content;
                }
            }
            catch {
                // Ignore malformed SSE payloads.
            }
        }
    }
}
async function streamCompletion(provider, input) {
    const { signal, cleanup } = createTimeoutSignal(PROVIDER_TIMEOUT_MS);
    try {
        const response = await fetch(input.baseUrl, {
            method: "POST",
            headers: buildProviderHeaders(provider, input.apiKey),
            body: JSON.stringify({
                model: input.model,
                messages: input.messages,
                stream: true,
                max_tokens: input.maxTokens,
                temperature: input.temperature,
            }),
            signal,
        });
        if (!response.ok) {
            throw new Error(`${provider} stream error: ${response.status} - ${await response.text()}`);
        }
        return consumeSseResponse(response);
    }
    finally {
        cleanup();
    }
}
async function createAIChatStream(input) {
    const maxTokens = input.maxTokens ?? 1200;
    const temperature = input.temperature ?? 0.4;
    const selectedProvider = input.providerOrder[0];
    let lastError = null;
    for (const provider of input.providerOrder) {
        const config = await (0, chat_store_1.resolveChatProviderConfig)(provider);
        if (!config.enabled) {
            continue;
        }
        if (provider !== "local" && !config.apiKey) {
            continue;
        }
        const model = resolveModel(provider, selectedProvider, input.model, config.defaultModel);
        try {
            return {
                provider,
                model,
                stream: await streamCompletion(provider, {
                    apiKey: config.apiKey,
                    baseUrl: config.baseUrl,
                    maxTokens,
                    messages: input.messages,
                    model,
                    temperature,
                }),
            };
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }
    throw lastError ?? new Error("No streaming AI provider is currently available.");
}

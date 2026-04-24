var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
import "server-only";
import { resolveChatProviderConfig } from './chat-store';
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
    var _a, _b;
    const choice = (_a = data.choices) === null || _a === void 0 ? void 0 : _a[0];
    const message = choice === null || choice === void 0 ? void 0 : choice.message;
    if (!message) {
        return null;
    }
    const content = (_b = message.content) !== null && _b !== void 0 ? _b : null;
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
function fetchCompletion(provider, input) {
    return __awaiter(this, void 0, void 0, function* () {
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
            const response = yield fetch(input.baseUrl, {
                method: "POST",
                headers: buildProviderHeaders(provider, input.apiKey),
                body: JSON.stringify(requestBody),
                signal,
            });
            if (!response.ok) {
                throw new Error(`${provider} error: ${response.status} - ${yield response.text()}`);
            }
            return (yield response.json());
        }
        finally {
            cleanup();
        }
    });
}
export function requestAIChatCompletion(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const maxTokens = (_a = input.maxTokens) !== null && _a !== void 0 ? _a : 1200;
        const temperature = (_b = input.temperature) !== null && _b !== void 0 ? _b : 0.4;
        const selectedProvider = input.providerOrder[0];
        let lastError = null;
        for (const provider of input.providerOrder) {
            const config = yield resolveChatProviderConfig(provider);
            if (!config.enabled) {
                continue;
            }
            if (provider !== "local" && !config.apiKey) {
                continue;
            }
            const model = resolveModel(provider, selectedProvider, input.model, config.defaultModel);
            try {
                const data = yield fetchCompletion(provider, {
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
        throw lastError !== null && lastError !== void 0 ? lastError : new Error("No AI provider is currently available.");
    });
}
function consumeSseResponse(response) {
    return __asyncGenerator(this, arguments, function* consumeSseResponse_1() {
        var _a, _b, _c, _d, _e;
        const reader = (_a = response.body) === null || _a === void 0 ? void 0 : _a.getReader();
        if (!reader) {
            throw new Error("Provider returned an empty SSE body.");
        }
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
            const { done, value } = yield __await(reader.read());
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = (_b = lines.pop()) !== null && _b !== void 0 ? _b : "";
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
                    const content = (_e = (_d = (_c = data.choices) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.delta) === null || _e === void 0 ? void 0 : _e.content;
                    if (content) {
                        yield yield __await(content);
                    }
                }
                catch (_f) {
                    // Ignore malformed SSE payloads.
                }
            }
        }
    });
}
function streamCompletion(provider, input) {
    return __awaiter(this, void 0, void 0, function* () {
        const { signal, cleanup } = createTimeoutSignal(PROVIDER_TIMEOUT_MS);
        try {
            const response = yield fetch(input.baseUrl, {
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
                throw new Error(`${provider} stream error: ${response.status} - ${yield response.text()}`);
            }
            return consumeSseResponse(response);
        }
        finally {
            cleanup();
        }
    });
}
export function createAIChatStream(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const maxTokens = (_a = input.maxTokens) !== null && _a !== void 0 ? _a : 1200;
        const temperature = (_b = input.temperature) !== null && _b !== void 0 ? _b : 0.4;
        const selectedProvider = input.providerOrder[0];
        let lastError = null;
        for (const provider of input.providerOrder) {
            const config = yield resolveChatProviderConfig(provider);
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
                    stream: yield streamCompletion(provider, {
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
        throw lastError !== null && lastError !== void 0 ? lastError : new Error("No streaming AI provider is currently available.");
    });
}

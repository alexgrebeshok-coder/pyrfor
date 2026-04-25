/**
 * External Adapter interface + implementations
 *
 * Adapters allow executing agents on external platforms:
 * - internal: uses CEOClaw's own execution engine (default)
 * - openclaw: calls OpenClaw cloud API via SSE
 * - webhook: fires a generic webhook
 * - telegram: sends task via Telegram bot
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../observability/logger.js';
// ── OpenClaw SSE Adapter ──
export class OpenClawAdapter {
    constructor() {
        this.type = "openclaw";
    }
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            const baseUrl = (_a = params.config.openclawUrl) !== null && _a !== void 0 ? _a : process.env.OPENCLAW_API_URL;
            const apiKey = (_b = params.config.openclawApiKey) !== null && _b !== void 0 ? _b : process.env.OPENCLAW_API_KEY;
            if (!baseUrl || !apiKey) {
                throw new Error("OpenClaw adapter: missing openclawUrl or openclawApiKey");
            }
            // POST to OpenClaw's agent execution endpoint, then stream SSE response
            const res = yield fetch(`${baseUrl}/api/agents/execute`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    agent_id: params.agentId,
                    prompt: params.prompt,
                    stream: true,
                }),
            });
            if (!res.ok) {
                throw new Error(`OpenClaw API error: ${res.status} ${yield res.text()}`);
            }
            // Parse SSE stream
            const reader = (_c = res.body) === null || _c === void 0 ? void 0 : _c.getReader();
            if (!reader)
                throw new Error("OpenClaw: no response body");
            const decoder = new TextDecoder();
            let fullContent = "";
            let totalTokens = 0;
            let costUsd = 0;
            let model = "openclaw";
            try {
                while (true) {
                    const { done, value } = yield reader.read();
                    if (done)
                        break;
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split("\n");
                    for (const line of lines) {
                        if (!line.startsWith("data: "))
                            continue;
                        const data = line.slice(6).trim();
                        if (data === "[DONE]")
                            break;
                        try {
                            const event = JSON.parse(data);
                            if (event.type === "content") {
                                fullContent += (_d = event.content) !== null && _d !== void 0 ? _d : "";
                                (_e = params.onEvent) === null || _e === void 0 ? void 0 : _e.call(params, `content: ${((_f = event.content) !== null && _f !== void 0 ? _f : "").slice(0, 100)}`);
                            }
                            else if (event.type === "usage") {
                                totalTokens = (_g = event.totalTokens) !== null && _g !== void 0 ? _g : 0;
                                costUsd = (_h = event.costUsd) !== null && _h !== void 0 ? _h : 0;
                                model = (_j = event.model) !== null && _j !== void 0 ? _j : "openclaw";
                            }
                            else if (event.type === "error") {
                                throw new Error((_k = event.message) !== null && _k !== void 0 ? _k : "OpenClaw execution error");
                            }
                        }
                        catch (e) {
                            if (e instanceof SyntaxError)
                                continue;
                            throw e;
                        }
                    }
                }
            }
            finally {
                reader.releaseLock();
            }
            return {
                content: fullContent,
                tokens: totalTokens,
                costUsd,
                model,
                provider: "openclaw",
            };
        });
    }
}
// ── Webhook Adapter ──
export class WebhookAdapter {
    constructor() {
        this.type = "webhook";
    }
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            const url = params.config.webhookUrl;
            const secret = params.config.webhookSecret;
            if (!url) {
                throw new Error("Webhook adapter: missing webhookUrl in config");
            }
            const headers = {
                "Content-Type": "application/json",
            };
            if (secret) {
                headers["X-Webhook-Secret"] = secret;
            }
            (_a = params.onEvent) === null || _a === void 0 ? void 0 : _a.call(params, "Calling webhook...");
            const res = yield fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    agent_id: params.agentId,
                    prompt: params.prompt,
                    timestamp: new Date().toISOString(),
                }),
                signal: AbortSignal.timeout(60000),
            });
            if (!res.ok) {
                throw new Error(`Webhook returned ${res.status}: ${yield res.text()}`);
            }
            const body = yield res.json();
            return {
                content: (_c = (_b = body.content) !== null && _b !== void 0 ? _b : body.result) !== null && _c !== void 0 ? _c : JSON.stringify(body),
                tokens: (_d = body.tokens) !== null && _d !== void 0 ? _d : 0,
                costUsd: (_e = body.costUsd) !== null && _e !== void 0 ? _e : 0,
                model: (_f = body.model) !== null && _f !== void 0 ? _f : "webhook",
                provider: "webhook",
            };
        });
    }
}
// ── Adapter Registry ──
const adapters = {
    openclaw: new OpenClawAdapter(),
    webhook: new WebhookAdapter(),
};
export function getAdapter(type) {
    var _a;
    return (_a = adapters[type]) !== null && _a !== void 0 ? _a : null;
}
export function registerAdapter(adapter) {
    adapters[adapter.type] = adapter;
    logger.info(`Registered external adapter: ${adapter.type}`);
}

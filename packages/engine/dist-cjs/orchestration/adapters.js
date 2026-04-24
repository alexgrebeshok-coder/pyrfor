"use strict";
/**
 * External Adapter interface + implementations
 *
 * Adapters allow executing agents on external platforms:
 * - internal: uses CEOClaw's own execution engine (default)
 * - openclaw: calls OpenClaw cloud API via SSE
 * - webhook: fires a generic webhook
 * - telegram: sends task via Telegram bot
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookAdapter = exports.OpenClawAdapter = void 0;
exports.getAdapter = getAdapter;
exports.registerAdapter = registerAdapter;
const logger_1 = require("../observability/logger");
// ── OpenClaw SSE Adapter ──
class OpenClawAdapter {
    constructor() {
        this.type = "openclaw";
    }
    async execute(params) {
        const baseUrl = params.config.openclawUrl ?? process.env.OPENCLAW_API_URL;
        const apiKey = params.config.openclawApiKey ?? process.env.OPENCLAW_API_KEY;
        if (!baseUrl || !apiKey) {
            throw new Error("OpenClaw adapter: missing openclawUrl or openclawApiKey");
        }
        // POST to OpenClaw's agent execution endpoint, then stream SSE response
        const res = await fetch(`${baseUrl}/api/agents/execute`, {
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
            throw new Error(`OpenClaw API error: ${res.status} ${await res.text()}`);
        }
        // Parse SSE stream
        const reader = res.body?.getReader();
        if (!reader)
            throw new Error("OpenClaw: no response body");
        const decoder = new TextDecoder();
        let fullContent = "";
        let totalTokens = 0;
        let costUsd = 0;
        let model = "openclaw";
        try {
            while (true) {
                const { done, value } = await reader.read();
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
                            fullContent += event.content ?? "";
                            params.onEvent?.(`content: ${(event.content ?? "").slice(0, 100)}`);
                        }
                        else if (event.type === "usage") {
                            totalTokens = event.totalTokens ?? 0;
                            costUsd = event.costUsd ?? 0;
                            model = event.model ?? "openclaw";
                        }
                        else if (event.type === "error") {
                            throw new Error(event.message ?? "OpenClaw execution error");
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
    }
}
exports.OpenClawAdapter = OpenClawAdapter;
// ── Webhook Adapter ──
class WebhookAdapter {
    constructor() {
        this.type = "webhook";
    }
    async execute(params) {
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
        params.onEvent?.("Calling webhook...");
        const res = await fetch(url, {
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
            throw new Error(`Webhook returned ${res.status}: ${await res.text()}`);
        }
        const body = await res.json();
        return {
            content: body.content ?? body.result ?? JSON.stringify(body),
            tokens: body.tokens ?? 0,
            costUsd: body.costUsd ?? 0,
            model: body.model ?? "webhook",
            provider: "webhook",
        };
    }
}
exports.WebhookAdapter = WebhookAdapter;
// ── Adapter Registry ──
const adapters = {
    openclaw: new OpenClawAdapter(),
    webhook: new WebhookAdapter(),
};
function getAdapter(type) {
    return adapters[type] ?? null;
}
function registerAdapter(adapter) {
    adapters[adapter.type] = adapter;
    logger_1.logger.info(`Registered external adapter: ${adapter.type}`);
}

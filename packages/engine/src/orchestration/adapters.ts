/**
 * External Adapter interface + implementations
 *
 * Adapters allow executing agents on external platforms:
 * - internal: uses CEOClaw's own execution engine (default)
 * - openclaw: calls OpenClaw cloud API via SSE
 * - webhook: fires a generic webhook
 * - telegram: sends task via Telegram bot
 */

import { logger } from "@/lib/logger";

// ── Interface ──

export interface AdapterResult {
  content: string;
  tokens: number;
  costUsd: number;
  model: string;
  provider: string;
}

export interface ExternalAdapter {
  type: string;
  execute(params: {
    agentId: string;
    prompt: string;
    config: Record<string, unknown>;
    onEvent?: (event: string) => void;
  }): Promise<AdapterResult>;
}

// ── OpenClaw SSE Adapter ──

export class OpenClawAdapter implements ExternalAdapter {
  readonly type = "openclaw";

  async execute(params: {
    agentId: string;
    prompt: string;
    config: Record<string, unknown>;
    onEvent?: (event: string) => void;
  }): Promise<AdapterResult> {
    const baseUrl = (params.config.openclawUrl as string) ?? process.env.OPENCLAW_API_URL;
    const apiKey = (params.config.openclawApiKey as string) ?? process.env.OPENCLAW_API_KEY;

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
    if (!reader) throw new Error("OpenClaw: no response body");

    const decoder = new TextDecoder();
    let fullContent = "";
    let totalTokens = 0;
    let costUsd = 0;
    let model = "openclaw";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;

          try {
            const event = JSON.parse(data);
            if (event.type === "content") {
              fullContent += event.content ?? "";
              params.onEvent?.(`content: ${(event.content ?? "").slice(0, 100)}`);
            } else if (event.type === "usage") {
              totalTokens = event.totalTokens ?? 0;
              costUsd = event.costUsd ?? 0;
              model = event.model ?? "openclaw";
            } else if (event.type === "error") {
              throw new Error(event.message ?? "OpenClaw execution error");
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } finally {
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

// ── Webhook Adapter ──

export class WebhookAdapter implements ExternalAdapter {
  readonly type = "webhook";

  async execute(params: {
    agentId: string;
    prompt: string;
    config: Record<string, unknown>;
    onEvent?: (event: string) => void;
  }): Promise<AdapterResult> {
    const url = params.config.webhookUrl as string;
    const secret = params.config.webhookSecret as string;

    if (!url) {
      throw new Error("Webhook adapter: missing webhookUrl in config");
    }

    const headers: Record<string, string> = {
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

// ── Adapter Registry ──

const adapters: Record<string, ExternalAdapter> = {
  openclaw: new OpenClawAdapter(),
  webhook: new WebhookAdapter(),
};

export function getAdapter(type: string): ExternalAdapter | null {
  return adapters[type] ?? null;
}

export function registerAdapter(adapter: ExternalAdapter) {
  adapters[adapter.type] = adapter;
  logger.info(`Registered external adapter: ${adapter.type}`);
}

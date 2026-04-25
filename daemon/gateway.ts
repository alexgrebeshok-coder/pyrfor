/**
 * Pyrfor Daemon — Gateway Server
 *
 * HTTP + optional WebSocket server that:
 * - Exposes health/status endpoints
 * - Accepts AI chat requests (proxies to providers)
 * - Provides RPC for the Next.js web app
 * - Manages cron, Telegram, voice subsystems
 *
 * Improved over OpenClaw:
 * - TypeScript strict types
 * - Prisma integration (not file-based storage)
 * - Simpler auth (token-based, no Tailscale)
 * - JSON API responses (not raw WebSocket RPC)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { parse as parseUrl } from "url";
import { createLogger } from "./logger";
import type { DaemonConfig } from "./config";
import type { HealthMonitor, HealthSnapshot } from "./health";
import type { CronService, JobStatus } from "./cron/service";
import type { BotRunner } from "./telegram/bot";

const log = createLogger("gateway");

// ─── Types ─────────────────────────────────────────────────────────────────

interface GatewayDeps {
  config: DaemonConfig;
  health: HealthMonitor;
  cron: CronService;
  telegramRunner: BotRunner | null;
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: string
) => Promise<void>;

// ─── Helpers ───────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ─── Gateway Server ────────────────────────────────────────────────────────

export function createGatewayServer(deps: GatewayDeps) {
  const { config, health, cron, telegramRunner } = deps;
  const authToken = config.gateway.auth.token;
  const requireAuth = config.gateway.auth.mode === "token" && !!authToken;

  // ─── Auth Middleware ─────────────────────────────────────────────────

  function checkAuth(req: IncomingMessage): boolean {
    if (!requireAuth) return true;

    const authHeader = req.headers.authorization;
    if (!authHeader) return false;

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    return token === authToken;
  }

  // ─── Routes ──────────────────────────────────────────────────────────

  const routes: Record<string, Record<string, RouteHandler>> = {
    // Health & Status
    "GET /health": {
      handler: async (_req, res) => {
        const snapshot = await health.runChecks();
        const status = snapshot.daemon === "healthy" ? 200 : 503;
        sendJson(res, status, snapshot);
      },
    },

    "GET /status": {
      handler: async (_req, res) => {
        const snapshot = health.getLastSnapshot();
        const cronStatus = cron.getStatus();

        sendJson(res, 200, {
          daemon: {
            status: snapshot?.daemon ?? "unknown",
            uptime: snapshot?.uptime ?? 0,
            startedAt: snapshot?.startedAt ?? null,
            version: snapshot?.version ?? "unknown",
          },
          telegram: {
            running: telegramRunner?.isRunning() ?? false,
            mode: config.telegram.mode,
          },
          cron: {
            running: cron.isRunning(),
            jobs: cronStatus,
          },
          subsystems: snapshot?.subsystems ?? [],
        });
      },
    },

    // Cron Management
    "GET /cron/jobs": {
      handler: async (_req, res) => {
        sendJson(res, 200, { jobs: cron.getStatus() });
      },
    },

    "POST /cron/trigger": {
      handler: async (_req, res, body) => {
        const { jobId } = JSON.parse(body || "{}");
        if (!jobId) {
          sendJson(res, 400, { error: "jobId required" });
          return;
        }
        try {
          await cron.triggerJob(jobId);
          sendJson(res, 200, { ok: true, jobId });
        } catch (err) {
          sendJson(res, 404, {
            error: err instanceof Error ? err.message : "Job not found",
          });
        }
      },
    },

    // AI Chat (OpenAI-compatible endpoint for compatibility with openclaw-gateway.ts)
    "POST /v1/chat/completions": {
      handler: async (_req, res, body) => {
        // This endpoint allows the Next.js app to route AI requests through the daemon
        // For now, forward to configured AI providers
        try {
          const request = JSON.parse(body);
          const messages = request.messages ?? [];
          const lastMessage = messages[messages.length - 1];
          const prompt = lastMessage?.content ?? "";

          if (!prompt) {
            sendJson(res, 400, { error: "No prompt provided" });
            return;
          }

          // Route to first available AI provider
          const result = await routeToAIProvider(prompt, config);

          // Return in OpenAI-compatible format
          sendJson(res, 200, {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: config.ai.defaultModel ?? "pyrfor-daemon",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: result.content },
                finish_reason: "stop",
              },
            ],
            toolResults: result.toolResults ?? null,
          });
        } catch (err) {
          sendJson(res, 500, {
            error: err instanceof Error ? err.message : "AI request failed",
          });
        }
      },
    },

    // Ping
    "GET /ping": {
      handler: async (_req, res) => {
        sendJson(res, 200, { pong: true, timestamp: Date.now() });
      },
    },
  };

  // ─── HTTP Server ─────────────────────────────────────────────────────

  const server = createServer(async (req, res) => {
    const parsed = parseUrl(req.url ?? "/", true);
    const method = req.method ?? "GET";
    const pathname = parsed.pathname ?? "/";

    // Skip ngrok warning page for free tier
    res.setHeader("ngrok-skip-browser-warning", "true");

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-openclaw-auth, x-openclaw-session-key",
      });
      res.end();
      return;
    }

    // Auth check (skip for /ping and /health)
    if (pathname !== "/ping" && pathname !== "/health") {
      if (!checkAuth(req)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
    }

    // Route matching
    const routeKey = `${method} ${pathname}`;
    const route = routes[routeKey];

    if (route) {
      try {
        const body = method === "POST" ? await readBody(req) : "";
        await route.handler(req, res, body);
      } catch (err) {
        log.error("Route handler error", {
          route: routeKey,
          error: err instanceof Error ? err.message : String(err),
        });
        sendJson(res, 500, { error: "Internal server error" });
      }
    } else {
      sendJson(res, 404, { error: "Not found", path: pathname });
    }
  });

  // ─── Server Controls ─────────────────────────────────────────────────

  return {
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        const bind =
          config.gateway.bind === "loopback"
            ? "127.0.0.1"
            : config.gateway.bind === "lan"
              ? "0.0.0.0"
              : "0.0.0.0";

        server.listen(config.gateway.port, bind, () => {
          log.info("Gateway server started", {
            port: config.gateway.port,
            bind,
            auth: requireAuth ? "token" : "none",
          });
          resolve();
        });

        server.on("error", (err) => {
          log.error("Gateway server error", { error: err.message });
          reject(err);
        });
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => {
          log.info("Gateway server stopped");
          resolve();
        });
      });
    },

    get port(): number {
      return config.gateway.port;
    },
  };
}

// ─── AI Provider Routing ───────────────────────────────────────────────────

import {
  executeAIKernelToolCalls,
  getAIKernelToolDefinitions,
} from "../packages/engine/src/ai/kernel-tool-plane";
import type { AIToolCall } from "../packages/engine/src/ai/tools";

interface AIRouteResult {
  content: string;
  toolResults?: Array<{ name: string; success: boolean; displayMessage: string }>;
}

async function routeToAIProvider(
  prompt: string,
  config: DaemonConfig
): Promise<AIRouteResult> {
  // Try providers in order: config.ai.providers, then built-in fallbacks
  const providers = [
    ...config.ai.providers,
    // Built-in fallbacks
    {
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKeyEnvVar: "OPENROUTER_API_KEY",
      defaultModel: "openai/gpt-4o-mini",
    },
    {
      name: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKeyEnvVar: "OPENAI_API_KEY",
      defaultModel: "gpt-4o-mini",
    },
  ];

  for (const provider of providers) {
    const apiKey = provider.apiKeyEnvVar
      ? process.env[provider.apiKeyEnvVar]
      : undefined;

    if (!apiKey) continue;

    try {
      const response = await fetch(`${provider.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: provider.defaultModel,
          messages: [{ role: "user", content: prompt }],
          tools: getAIKernelToolDefinitions(),
          tool_choice: "auto",
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices: Array<{
            message: {
              content?: string | null;
              tool_calls?: AIToolCall[];
            };
          }>;
        };

        const message = data.choices[0]?.message;
        const content = message?.content ?? "";
        const toolCalls = message?.tool_calls;

        // Execute tool calls if present
        if (toolCalls && toolCalls.length > 0) {
          log.info("Executing tool calls", {
            count: toolCalls.length,
            tools: toolCalls.map((c) => c.function.name).join(", "),
          });

          const results = await executeAIKernelToolCalls(toolCalls);
          const toolMessages = results.map((r) => r.displayMessage);
          const combinedContent = content
            ? `${content}\n\n${toolMessages.join("\n\n")}`
            : toolMessages.join("\n\n");

          return {
            content: combinedContent,
            toolResults: results.map((r) => ({
              name: r.name,
              success: r.success,
              displayMessage: r.displayMessage,
            })),
          };
        }

        return { content: content || "No response" };
      }
    } catch {
      continue;
    }
  }

  throw new Error("No AI providers available");
}

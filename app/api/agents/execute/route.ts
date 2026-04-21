/**
 * Agent Execute API - Run agents via `runAgentExecution` kernel.
 *
 * The canonical executor lives in `lib/ai/agent-executor.ts`; this
 * route calls it directly and retains the legacy retry/fallback
 * surface through a small in-route loop. Smart agent selection lives
 * in `lib/agents/smart-selector.ts` and per-provider rate limiting in
 * `lib/agents/rate-limiter.ts` (both extracted from the retired
 * `ImprovedAgentExecutor` in Wave F).
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { AgentOrchestrator } from "@/lib/agents/orchestrator";
import { memoryManager, contextBuilder } from "@/lib/memory/memory-manager";
import { smartSelector } from "@/lib/agents/smart-selector";
import { rateLimiter } from "@/lib/agents/rate-limiter";
import { runAgentExecution } from "@/lib/ai/agent-executor";
import { getRouter } from "@/lib/ai/providers";
import type { Message } from "@/lib/ai/providers";
import { logger } from "@/lib/logger";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 3;
const BACKOFF_MS = 1_000;
const BACKOFF_MULT = 2;
const RETRYABLE_ERRORS = [
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "socket hang up",
  "rate_limit",
  "rate limit",
  "overloaded",
  "timeout",
  "429",
  "502",
  "503",
  "504",
];

const AGENT_PROMPTS: Record<string, string> = {
  main: "Ты CEOClaw Main — оркестратор. Координируешь работу, общаешься с пользователем.",
  "quick-research":
    "Ты Research Agent — ищешь информацию в интернете и анализируешь данные.",
  "quick-coder":
    "Ты Coder Agent — пишешь код, исправляешь баги, рефакторишь.",
  writer: "Ты Writer Agent — пишешь тексты, документацию, отчёты.",
  planner:
    "Ты Planner Agent — планируешь задачи, оцениваешь сроки, распределяешь ресурсы.",
  "main-reviewer":
    "Ты Reviewer Agent — проверяешь качество, находишь ошибки, даёшь фидбек.",
  "main-worker":
    "Ты Worker Agent — выполняешь задачи, работаешь с файлами, запускаешь скрипты.",
};

const PROVIDER_MODEL_HINTS: Record<string, string> = {
  openrouter: "google/gemini-3.1-flash-lite-preview",
  zai: "glm-5",
  openai: "gpt-5.2",
  mock: "mock",
};

function buildSystemPromptForAgent(
  agentId: string,
  context: Record<string, unknown>
): string {
  const basePrompt = AGENT_PROMPTS[agentId] ?? AGENT_PROMPTS.main;
  return `${basePrompt}

Контекст:
${JSON.stringify(context, null, 2)}

Отвечай кратко, по делу. Используй данные из контекста.`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isRetryableError(message: string): boolean {
  const lower = message.toLowerCase();
  return RETRYABLE_ERRORS.some((err) => lower.includes(err.toLowerCase()));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RunAttemptResult {
  success: boolean;
  content: string;
  tokens: number;
  cost: number;
  durationMs: number;
  provider: string;
  model: string;
  error?: string;
}

/**
 * Run a single provider/model attempt through `runAgentExecution`,
 * wrapped with an `AbortController`-driven timeout. Errors propagate so
 * the caller can decide whether to retry or fall back.
 */
async function runSingleAttempt(
  agentId: string,
  systemPrompt: string,
  task: string,
  provider: string,
  timeoutMs: number,
  workspaceId: string | undefined
): Promise<RunAttemptResult> {
  const controller = new AbortController();
  const start = Date.now();
  const model = PROVIDER_MODEL_HINTS[provider] ?? "unknown";
  const runId = `api-exec-${agentId}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: task },
    ];

    const result = await runAgentExecution(messages, {
      router: getRouter(),
      provider,
      agentId,
      runId,
      workspaceId,
      enableTools: false,
      signal: controller.signal,
    });

    if (result.aborted) {
      throw new Error(`Execution aborted (duration=${result.durationMs}ms)`);
    }

    const content = result.finalContent ?? "";
    const tokens = estimateTokens(systemPrompt + task + content);

    return {
      success: true,
      content,
      tokens,
      // Cost is tracked in-kernel via `trackCost`; surface a rough client
      // estimate so existing UI bindings stay meaningful. Authoritative
      // spend lives in `AIRunCost`.
      cost: content.length * 0.000001,
      durationMs: Date.now() - start,
      provider,
      model,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function executeWithRetryAndFallback(params: {
  agentId: string;
  task: string;
  context: Record<string, unknown>;
  providers: string[];
  maxRetries: number;
  timeoutMs: number;
  fallbackOnError: boolean;
  saveToMemory: boolean;
  workspaceId: string | undefined;
}): Promise<RunAttemptResult & { attempts: number }> {
  const {
    agentId,
    task,
    context,
    providers,
    maxRetries,
    timeoutMs,
    fallbackOnError,
    saveToMemory,
    workspaceId,
  } = params;

  const systemPrompt = buildSystemPromptForAgent(agentId, context);
  const startMs = Date.now();
  let attempts = 0;
  let lastError: string | undefined;
  let lastProvider = providers[0] ?? "unknown";

  for (const provider of providers) {
    attempts++;
    lastProvider = provider;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await runSingleAttempt(
          agentId,
          systemPrompt,
          task,
          provider,
          timeoutMs,
          workspaceId
        );

        if (saveToMemory) {
          memoryManager.add({
            type: "episodic",
            category: "agent",
            key: `agent-${agentId}-${Date.now()}`,
            value: {
              agentId,
              task,
              result: result.content,
              success: result.success,
              provider,
              duration: Date.now() - startMs,
            },
            validFrom: new Date().toISOString(),
            validUntil: null,
            confidence: result.success ? 95 : 50,
            source: "system",
            tags: ["agent", agentId, provider],
          });
        }

        return { ...result, attempts };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn("[api/agents/execute] attempt failed", {
          agentId,
          provider,
          attempt,
          maxRetries,
          error: lastError,
        });

        if (!isRetryableError(lastError)) break;

        if (attempt < maxRetries) {
          const delay = BACKOFF_MS * Math.pow(BACKOFF_MULT, attempt - 1);
          await sleep(delay);
        }
      }
    }

    if (!fallbackOnError) break;
  }

  return {
    success: false,
    content: "",
    tokens: 0,
    cost: 0,
    durationMs: Date.now() - startMs,
    provider: lastProvider,
    model: PROVIDER_MODEL_HINTS[lastProvider] ?? "unknown",
    error: lastError,
    attempts,
  };
}

// POST - Execute agent
export async function POST(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, {
      permission: "RUN_AI_ACTIONS",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = await req.json();
    const { agentId, task, projectId, workspaceId, options } = body;

    const selectedAgent = agentId || smartSelector.selectAgent(task);
    const primaryProvider = options?.provider || "openrouter";

    if (!rateLimiter.canRequest(primaryProvider)) {
      const waitTime = rateLimiter.getWaitTime(primaryProvider);
      return NextResponse.json(
        {
          success: false,
          error: "Rate limit exceeded",
          waitTime,
          retryAfter: Math.ceil(waitTime / 1000),
        },
        { status: 429 }
      );
    }

    contextBuilder.build({ projectId });
    const context = {
      projectId,
      memory: memoryManager.getAll().slice(0, 10),
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    const providers: string[] =
      options?.fallback?.providers ??
      (options?.fallback?.enabled !== false
        ? [primaryProvider, ...["openrouter", "zai", "mock"].filter((p) => p !== primaryProvider)]
        : [primaryProvider]);

    const result = await executeWithRetryAndFallback({
      agentId: selectedAgent,
      task,
      context,
      providers,
      maxRetries: options?.retry?.maxRetries ?? DEFAULT_MAX_RETRIES,
      timeoutMs: options?.timeout ?? DEFAULT_TIMEOUT_MS,
      fallbackOnError: options?.fallback?.fallbackOnError !== false,
      saveToMemory: options?.saveToMemory !== false,
      workspaceId: typeof workspaceId === "string" ? workspaceId : undefined,
    });

    return NextResponse.json({
      success: result.success,
      result: {
        content: result.content,
        tokens: result.tokens,
        cost: result.cost,
        duration: result.durationMs,
        attempts: result.attempts,
        provider: result.provider,
        model: result.model,
      },
      agent: {
        id: selectedAgent,
        capabilities: smartSelector.getAgentCapabilities(selectedAgent),
      },
      timestamp: new Date().toISOString(),
      error: result.error,
    });
  } catch (error) {
    logger.error("Agent execute error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// GET - List agents / stats
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stats = searchParams.get("stats");
    const agentId = searchParams.get("agentId");

    const orchestrator = new AgentOrchestrator();

    if (stats) {
      const agentStats = await orchestrator.getStats(agentId || undefined);
      return NextResponse.json({ stats: agentStats });
    }

    const agents = orchestrator.getAllAgents().map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      description: a.description,
    }));

    return NextResponse.json({ agents });
  } catch (error) {
    logger.error("Agent list error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

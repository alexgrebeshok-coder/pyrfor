/**
 * AI Run Cost Tracker
 *
 * Estimates and records LLM API call costs.
 * Uses approximate token pricing per provider/model.
 * Records are written asynchronously to avoid blocking.
 */

import "server-only";

import { logger } from "@/lib/logger";
import { agentBus } from "@/lib/ai/messaging/agent-bus";

// ============================================
// Pricing tables (USD per 1K tokens, input/output)
// ============================================

interface ModelPrice {
  input: number;  // USD per 1K input tokens
  output: number; // USD per 1K output tokens
}

const PRICE_TABLE: Record<string, Record<string, ModelPrice>> = {
  openai: {
    "gpt-5.2":    { input: 0.002,  output: 0.008 },
    "gpt-5.1":    { input: 0.002,  output: 0.008 },
    "gpt-4o":     { input: 0.0025, output: 0.01  },
    "gpt-4o-mini":{ input: 0.00015,output: 0.0006},
  },
  openrouter: {
    "openai/gpt-4o-mini":             { input: 0.00015, output: 0.0006 },
    "google/gemma-3-27b-it:free":     { input: 0,       output: 0      },
    "google/gemma-3-12b-it:free":     { input: 0,       output: 0      },
    "google/gemma-3-4b-it:free":      { input: 0,       output: 0      },
  },
  gigachat: {
    "GigaChat":      { input: 0.00025, output: 0.00025 },
    "GigaChat-Plus": { input: 0.0005,  output: 0.0005  },
    "GigaChat-Pro":  { input: 0.001,   output: 0.001   },
  },
  yandexgpt: {
    "yandexgpt-lite": { input: 0.0002, output: 0.0002 },
    "yandexgpt":      { input: 0.0006, output: 0.0006 },
    "yandexgpt-32k":  { input: 0.0006, output: 0.0006 },
  },
  aijora:  { default: { input: 0.001, output: 0.003 } },
  polza:   { default: { input: 0.001, output: 0.003 } },
  bothub:  { default: { input: 0.001, output: 0.003 } },
  zai:     { default: { input: 0.0005, output: 0.001 } },
};

// ============================================
// Token estimation (cheap approximation)
// ============================================

type TokenEncoder = {
  encode(text: string): ArrayLike<number>;
};

let _tokenEncoder: TokenEncoder | null | undefined;

/** Prefer js-tiktoken when available, otherwise fall back to a rough char-based estimate. */
export function estimateTokens(text: string): number {
  const encoder = getTokenEncoder();
  if (encoder) {
    return encoder.encode(text).length;
  }
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: Array<{ content: string }>): number {
  return messages.reduce((acc, m) => acc + estimateTokens(m.content), 0);
}

// ============================================
// Cost calculation
// ============================================

export interface RunCost {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costRub: number; // approximate, 1 USD ≈ 90 RUB
}

const USD_TO_RUB = 90;

export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): RunCost {
  const providerPrices = PRICE_TABLE[provider] || {};
  const price: ModelPrice =
    providerPrices[model] ||
    providerPrices["default"] ||
    { input: 0.001, output: 0.003 }; // conservative fallback

  const costUsd =
    (inputTokens / 1000) * price.input +
    (outputTokens / 1000) * price.output;

  return {
    provider,
    model,
    inputTokens,
    outputTokens,
    costUsd,
    costRub: costUsd * USD_TO_RUB,
  };
}

// ============================================
// Async DB writer (fire-and-forget)
// ============================================

export interface CostRecord extends RunCost {
  agentId?: string;
  sessionId?: string;
  workspaceId?: string;
  runId?: string;
}

/**
 * Log a cost record to the database. Non-blocking — errors are logged, not thrown.
 *
 * Side-effect: after the row is persisted we refresh the workspace's daily
 * posture and, if a budget threshold was just crossed (80% warning or 100%
 * breach), publish a `budget.alert` event on the agent bus exactly once per
 * workspace/day/threshold. Consumers (UI banner, ops dashboard, Slack
 * webhook in a later wave) subscribe to this event.
 */
export async function trackCost(record: CostRecord): Promise<void> {
  await trackCostWithRetry(record);
  if (record.workspaceId) {
    // Fire-and-forget: breach detection must never block the caller.
    void maybePublishBudgetAlert(record);
  }
}

// ============================================
// Budget breach detection
// ============================================

/**
 * Thresholds (fraction of daily limit) at which we publish a `budget.alert`
 * event. Once a workspace crosses a threshold on a given UTC day we stop
 * re-emitting it for that day — the alert is meant to be actionable, not a
 * firehose.
 */
const BUDGET_ALERT_THRESHOLDS = [0.8, 1.0] as const;

export type BudgetAlertSeverity = "warning" | "breach";

export interface BudgetAlertPayload {
  workspaceId: string;
  severity: BudgetAlertSeverity;
  threshold: number; // 0..1
  totalUsdToday: number;
  dailyLimitUsd: number;
  utilization: number; // 0..1
  triggeredBy: {
    agentId?: string;
    runId?: string;
    provider: string;
    model: string;
    costUsd: number;
  };
  at: string; // ISO timestamp
}

const publishedAlerts = new Set<string>();

function alertKey(workspaceId: string, threshold: number, day: string) {
  return `${workspaceId}|${day}|${threshold}`;
}

function severityFor(threshold: number): BudgetAlertSeverity {
  return threshold >= 1 ? "breach" : "warning";
}

/**
 * Drop cached alert markers once per 24h so the set cannot grow unbounded
 * in long-running processes.
 */
function pruneAlertCache(currentDay: string) {
  for (const key of publishedAlerts) {
    if (!key.includes(`|${currentDay}|`)) {
      publishedAlerts.delete(key);
    }
  }
}

async function maybePublishBudgetAlert(record: CostRecord): Promise<void> {
  const workspaceId = record.workspaceId;
  if (!workspaceId) return;

  let posture: DailyCostPosture;
  try {
    posture = await getDailyCostPosture(workspaceId);
  } catch (err) {
    logger.warn("cost-tracker: breach check failed to load posture", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const dailyLimit = posture.dailyLimitUsd;
  if (dailyLimit <= 0) return;

  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  pruneAlertCache(day);

  for (const threshold of BUDGET_ALERT_THRESHOLDS) {
    if (posture.utilization < threshold) continue;
    const key = alertKey(workspaceId, threshold, day);
    if (publishedAlerts.has(key)) continue;
    publishedAlerts.add(key);

    const payload: BudgetAlertPayload = {
      workspaceId,
      severity: severityFor(threshold),
      threshold,
      totalUsdToday: posture.totalUsdToday,
      dailyLimitUsd: posture.dailyLimitUsd,
      utilization: posture.utilization,
      triggeredBy: {
        agentId: record.agentId,
        runId: record.runId,
        provider: record.provider,
        model: record.model,
        costUsd: record.costUsd,
      },
      at: new Date().toISOString(),
    };

    try {
      await agentBus.publish("budget.alert", payload, {
        source: "cost-tracker",
        workspaceId,
        runId: record.runId,
      });
      logger.warn("cost-tracker: budget alert published", {
        workspaceId,
        severity: payload.severity,
        threshold,
        utilization: posture.utilization,
      });
    } catch (err) {
      logger.warn("cost-tracker: failed to publish budget alert", {
        workspaceId,
        severity: payload.severity,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Fetch recent budget alerts for a workspace from the in-process bus log.
 * Used by the AI Ops dashboard to render a "recent breaches" panel.
 */
export function getRecentBudgetAlerts(
  workspaceId: string,
  limit = 20
): BudgetAlertPayload[] {
  const messages = agentBus.recent({
    type: "budget.alert",
    workspaceId,
    limit,
  });
  return messages
    .map((m) => m.payload as BudgetAlertPayload)
    .filter((p): p is BudgetAlertPayload => !!p && typeof p === "object");
}

/**
 * Internal helper — exposed for tests so they can clear state between runs.
 * @internal
 */
export function __resetBudgetAlertCacheForTests() {
  publishedAlerts.clear();
}

/**
 * Convenience: estimate input tokens from messages, then track after response.
 */
export function buildCostRecorder(
  provider: string,
  model: string,
  inputMessages: Array<{ content: string }>,
  meta?: Omit<CostRecord, "provider" | "model" | "inputTokens" | "outputTokens" | "costUsd" | "costRub">
) {
  const inputTokens = estimateMessagesTokens(inputMessages);

  return (responseText: string) => {
    const outputTokens = estimateTokens(responseText);
    const cost = calculateCost(provider, model, inputTokens, outputTokens);
    void trackCost({ ...cost, ...meta });
    return cost;
  };
}

export interface DailyCostPosture {
  workspaceId: string;
  totalUsdToday: number;
  dailyLimitUsd: number;
  utilization: number; // 0..1
  remainingUsd: number;
  recordCount: number;
  breachedAt?: string | null;
}

/**
 * Snapshot today's AI spend for a workspace against the configured daily
 * budget. Returns a best-effort posture; on database failure returns an
 * "unknown" posture (utilisation 0) so ops endpoints stay up even when the
 * cost store is misbehaving.
 */
export async function getDailyCostPosture(workspaceId: string): Promise<DailyCostPosture> {
  const dailyLimitUsd = parseFloat(process.env.AI_DAILY_COST_LIMIT ?? "50");
  try {
    const { prisma } = await import("@/lib/prisma");
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const today = await prisma.aIRunCost.aggregate({
      where: { workspaceId, createdAt: { gte: startOfDay } },
      _sum: { costUsd: true },
      _count: { _all: true },
    });
    const totalUsdToday = today._sum.costUsd ?? 0;
    const utilization = dailyLimitUsd > 0 ? Math.min(totalUsdToday / dailyLimitUsd, 1) : 0;
    return {
      workspaceId,
      totalUsdToday,
      dailyLimitUsd,
      utilization,
      remainingUsd: Math.max(dailyLimitUsd - totalUsdToday, 0),
      recordCount: today._count._all ?? 0,
      breachedAt: totalUsdToday >= dailyLimitUsd ? new Date().toISOString() : null,
    };
  } catch (err) {
    logger.warn("cost-tracker: daily posture lookup failed", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      workspaceId,
      totalUsdToday: 0,
      dailyLimitUsd,
      utilization: 0,
      remainingUsd: dailyLimitUsd,
      recordCount: 0,
      breachedAt: null,
    };
  }
}

export async function checkCostBudget(workspaceId: string): Promise<boolean> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const today = await prisma.aIRunCost.aggregate({
      where: {
        workspaceId,
        createdAt: { gte: startOfDay },
      },
      _sum: { costUsd: true },
    });
    const dailyLimitUsd = parseFloat(process.env.AI_DAILY_COST_LIMIT ?? "50");
    return (today._sum.costUsd ?? 0) < dailyLimitUsd;
  } catch (err) {
    logger.warn("cost-tracker: cost budget check failed, allowing request", {
      error: err instanceof Error ? err.message : String(err),
      workspaceId,
    });
    return true;
  }
}

async function trackCostWithRetry(record: CostRecord, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const { prisma } = await import("@/lib/prisma");
      await prisma.aIRunCost.create({
        data: {
          provider: record.provider,
          model: record.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          costUsd: record.costUsd,
          costRub: record.costRub,
          agentId: record.agentId,
          sessionId: record.sessionId,
          workspaceId: record.workspaceId,
          runId: record.runId,
        },
      });
      return;
    } catch (err) {
      if (attempt < maxRetries - 1) {
        await sleep(100 * Math.pow(2, attempt));
        continue;
      }

      logger.warn("cost-tracker: failed to persist cost record", {
        error: err instanceof Error ? err.message : String(err),
        provider: record.provider,
        model: record.model,
      });
    }
  }
}

function getTokenEncoder(): TokenEncoder | null {
  if (_tokenEncoder !== undefined) {
    return _tokenEncoder;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { encodingForModel } = require(/* webpackIgnore: true */ "js-tiktoken") as {
      encodingForModel: (model: string) => TokenEncoder;
    };
    _tokenEncoder = encodingForModel("gpt-4o");
  } catch {
    _tokenEncoder = null;
  }

  return _tokenEncoder;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

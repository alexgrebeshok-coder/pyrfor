/**
 * AI Run Cost Tracker
 *
 * Estimates and records LLM API call costs.
 * Uses approximate token pricing per provider/model.
 * Records are written asynchronously to avoid blocking.
 */

import { logger } from "@/lib/logger";

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

/** Rough token estimate: 1 token ≈ 4 chars */
export function estimateTokens(text: string): number {
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
 */
export async function trackCost(record: CostRecord): Promise<void> {
  try {
    // Lazy import to avoid circular deps and keep this file testable without Prisma
    const { prisma } = await import("@/lib/prisma");

    await (prisma as any).aIRunCost.create({
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
  } catch (err) {
    // Best-effort — never block the main request
    logger.warn("cost-tracker: failed to persist cost record", {
      error: err instanceof Error ? err.message : String(err),
      provider: record.provider,
      model: record.model,
    });
  }
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

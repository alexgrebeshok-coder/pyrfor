/**
 * Russian AI Provider Adapter
 *
 * Supports: AIJora, Polza.ai, OpenRouter, Bothub, OpenAI
 * OpenAI-compatible API with fallback chain
 */

import OpenAI from "openai";
import type {
  AIAdapter,
  AIApplyProposalInput,
  AIRunInput,
  AIRunRecord,
} from "@/lib/ai/types";
import { createMockAIAdapter } from "@/lib/ai/mock-adapter";
import { logger } from "@/lib/logger";
import {
  loadConfiguredAIProviderManifests,
} from "@/lib/ai/provider-manifests";

interface ProviderConfig {
  name: string;
  baseURL: string;
  envKey?: string; // Optional for local providers
  defaultModel: string;
  models: string[];
  source: "builtin" | "manifest";
}

// Provider configuration
const BUILTIN_PROVIDERS: ProviderConfig[] = [
  {
    name: "local-model",
    baseURL: "http://localhost:8000/v1",
    envKey: undefined, // No API key needed
    defaultModel: "v11",
    models: ["v10", "v11"],
    source: "builtin",
  },
  {
    name: "aijora",
    baseURL: "https://api.aijora.com/api/v1",
    envKey: "AIJORA_API_KEY",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini"],
    source: "builtin",
  },
  {
    name: "polza",
    baseURL: "https://polza.ai/api/v1",
    envKey: "POLZA_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
    models: ["openai/gpt-4o-mini"],
    source: "builtin",
  },
  {
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
    models: ["openai/gpt-4o-mini"],
    source: "builtin",
  },
  {
    name: "bothub",
    baseURL: "https://bothub.chat/api/v1",
    envKey: "BOTHUB_API_KEY",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini"],
    source: "builtin",
  },
  {
    name: "openai",
    baseURL: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini"],
    source: "builtin",
  },
];

type ProviderName = string;

function loadConfiguredProviders(env: NodeJS.ProcessEnv = process.env): ProviderConfig[] {
  const manifests = loadConfiguredAIProviderManifests(env);
  const providers = [...BUILTIN_PROVIDERS];

  for (const manifest of manifests) {
    if (providers.some((provider) => provider.name === manifest.name)) {
      logger.warn("Skipping duplicate AI provider manifest", {
        provider: manifest.name,
      });
      continue;
    }

    providers.push({
      name: manifest.name,
      baseURL: manifest.baseURL,
      envKey: manifest.apiKeyEnvVar,
      defaultModel: manifest.defaultModel,
      models: manifest.models ?? [manifest.defaultModel],
      source: "manifest",
    });
  }

  return providers;
}

// ─── Provider Availability Check ───────────────────────────────────────────

function getAvailableProviders(): ProviderConfig[] {
  const providers = loadConfiguredProviders().filter((p) => {
    // Local model doesn't need API key, just check if server is running
    if (p.name === "local-model") {
      return true; // Will be checked at runtime
    }
    
    if (!p.envKey) return false;
    const key = process.env[p.envKey];
    return key && key.length > 0;
  });

  if (providers.length === 0) {
    logger.error("No AI providers configured. Set at least one API key.", {
      required: loadConfiguredProviders().map((provider) => provider.envKey),
    });
  }

  return providers;
}

export function hasAvailableProviders(): boolean {
  return getAvailableProviders().length > 0;
}

// ───────────────────────────────────────────────────────────────────────────

// Error types
class ProviderError extends Error {
  constructor(
    public provider: ProviderName,
    public statusCode: number,
    message: string
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

class InsufficientFundsError extends ProviderError {
  constructor(provider: ProviderName) {
    super(provider, 402, "Insufficient funds");
    this.name = "InsufficientFundsError";
  }
}

class RateLimitError extends ProviderError {
  constructor(provider: ProviderName) {
    super(provider, 429, "Rate limit exceeded");
    this.name = "RateLimitError";
  }
}

// Provider adapter implementation
export class ProviderAdapter implements AIAdapter {
  mode = "provider" as const;
  private priority: ProviderName[];
  private timeout: number;
  private mockAdapter: ReturnType<typeof createMockAIAdapter>;
  private runStore = new Map<
    string,
    {
      input: AIRunInput;
      startedAt: number;
      run: AIRunRecord;
      finalRun?: AIRunRecord;
    }
  >();

  constructor(options?: {
    priority?: ProviderName[];
    timeout?: number;
  }) {
    this.priority = options?.priority || this.getDefaultPriority();
    this.timeout = options?.timeout || 30000; // 30s default
    this.mockAdapter = createMockAIAdapter();
  }

  private getDefaultPriority(): ProviderName[] {
    const envPriority = process.env.AI_PROVIDER_PRIORITY;
    if (envPriority) {
      return envPriority.split(",").filter((p) =>
        loadConfiguredProviders().some((prov) => prov.name === p)
      ) as ProviderName[];
    }
    return loadConfiguredProviders().map((provider) => provider.name);
  }

  private getProvider(name: ProviderName) {
    return loadConfiguredProviders().find((p) => p.name === name);
  }

  private isProviderAvailable(name: ProviderName): boolean {
    const provider = this.getProvider(name);
    if (!provider) {
      return false;
    }

    // Local model doesn't need API key
    if (provider.name === "local-model") {
      return true; // Always available at runtime
    }

    const key = provider.envKey ? process.env[provider.envKey] : undefined;
    return !!(key && key.length > 0);
  }

  private createRunId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `ai-run-${crypto.randomUUID()}`;
    }
    return `ai-run-${Math.random().toString(36).slice(2, 10)}`;
  }

  async runAgent(input: AIRunInput & { signal?: AbortSignal }): Promise<AIRunRecord> {
    const { signal, ...restInput } = input;
    const now = new Date().toISOString();
    const runId = this.createRunId();

    // Create initial run record
    const run: AIRunRecord = {
      id: runId,
      agentId: input.agent.id,
      title: "AI Provider Run",
      prompt: input.prompt,
      quickActionId: input.quickAction?.id,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      context: input.context.activeContext,
    };

    this.runStore.set(runId, {
      input: restInput,
      startedAt: Date.now(),
      run,
    });

    // Try to run with providers (async, will be polled via getRun)
    this.executeWithProviders(runId, restInput, signal).catch((error) => {
      logger.error("All AI providers failed", { error: error instanceof Error ? error.message : String(error) });
      const entry = this.runStore.get(runId);
      if (entry) {
        entry.finalRun = this.buildFailedRun(runId, input, run, error);
      }
    });

    return run;
  }

  private async executeWithProviders(
    runId: string,
    input: AIRunInput,
    signal?: AbortSignal
  ): Promise<void> {
    const errors: Error[] = [];
    const attemptedProviders: ProviderName[] = [];

    for (const providerName of this.priority) {
      // Check if aborted
      if (signal?.aborted) {
        throw new Error("Request aborted");
      }

      if (!this.isProviderAvailable(providerName)) {
        logger.debug("Provider not available (no API key)", { provider: providerName });
        continue;
      }

      try {
        logger.info("Trying AI provider", { provider: providerName });
        attemptedProviders.push(providerName);
        const result = await this.tryProvider(providerName, input, signal);
        logger.info("Provider succeeded", { provider: providerName });

        // Update run store with result
        const entry = this.runStore.get(runId);
        if (entry) {
          entry.finalRun = this.buildFinalRun(runId, input, result, providerName);
        }
        return;
      } catch (error) {
        logger.warn("Provider failed", { provider: providerName, error: error instanceof Error ? error.message : String(error) });
        errors.push(error as Error);

        // Don't retry on auth/funds errors
        if (
          error instanceof InsufficientFundsError ||
          (error as ProviderError).statusCode === 401
        ) {
          continue;
        }

        // Wait 1s on rate limit, then try next
        if (error instanceof RateLimitError) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    // All providers failed - mark the run failed explicitly instead of fabricating success.
    logger.warn("All providers failed, marking run failed", {
      attemptedProviders,
      errorCount: errors.length,
    });
    const entry = this.runStore.get(runId);
    if (entry) {
      entry.finalRun = this.buildFailedRun(runId, input, entry.run, {
        message:
          attemptedProviders.length > 0
            ? `All attempted AI providers failed: ${attemptedProviders.join(", ")}${errors.length > 0 ? `. Last error: ${errors[errors.length - 1]?.message ?? "Unknown error"}` : ""}`
            : "No configured AI providers were available.",
      });
    }
  }

  private async tryProvider(
    providerName: ProviderName,
    input: AIRunInput,
    signal?: AbortSignal
  ): Promise<string> {
    const provider = this.getProvider(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    // Local model doesn't need API key
    const apiKey = provider.envKey ? process.env[provider.envKey] : "local-no-key";
    if (!apiKey) {
      throw new Error(`No API key for provider: ${providerName}`);
    }

    // For local model, use shorter timeout and check availability
    const timeout = providerName === "local-model" ? 10000 : this.timeout;

    const client = new OpenAI({
      apiKey,
      baseURL: provider.baseURL,
      timeout,
    });

    try {
      // Build prompt with context
      const systemPrompt = this.buildSystemPrompt(input);
      const userPrompt = this.buildUserPrompt(input);

      const response = await client.chat.completions.create(
        {
          model: provider.defaultModel,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        },
        {
          signal,
        }
      );

      const content = response.choices[0]?.message?.content || "";
      return content;
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      // Classify errors
      if (err.status === 401 || err.status === 403) {
        throw new ProviderError(
          providerName,
          err.status,
          "Authentication failed"
        );
      }
      if (err.status === 402) {
        throw new InsufficientFundsError(providerName);
      }
      if (err.status === 429) {
        throw new RateLimitError(providerName);
      }

      // Re-throw with context
      throw new ProviderError(
        providerName,
        err.status || 500,
        err.message || "Unknown error"
      );
    }
  }

  private buildSystemPrompt(input: AIRunInput): string {
    const locale = input.context.locale;
    const isRussian = locale === "ru";

    return isRussian
      ? `Ты — AI-ассистент для управления проектами. Анализируй данные и предлагай конкретные действия.

Отвечай в формате JSON:
{
  "summary": "Краткое резюме анализа",
  "highlights": ["Ключевой момент 1", "Ключевой момент 2", "Ключевой момент 3"],
  "nextSteps": ["Рекомендация 1", "Рекомендация 2", "Рекомендация 3"]
}

Будь кратким, конкретным и практичным. Фокусируйся на действиях, а не описаниях.`
      : `You are an AI assistant for project management. Analyze data and propose concrete actions.

Respond in JSON format:
{
  "summary": "Brief analysis summary",
  "highlights": ["Key point 1", "Key point 2", "Key point 3"],
  "nextSteps": ["Recommendation 1", "Recommendation 2", "Recommendation 3"]
}

Be concise, specific, and practical. Focus on actions, not descriptions.`;
  }

  private buildUserPrompt(input: AIRunInput): string {
    const context = input.context;
    const project = context.project;
    const activeContext = context.activeContext;

    let prompt = input.prompt;

    // Add context information
    prompt += "\n\n--- Context ---\n";
    prompt += `Active view: ${activeContext.title}\n`;

    if (project) {
      prompt += `\nProject: ${project.name}\n`;
      prompt += `Progress: ${project.progress}%\n`;
      prompt += `Health: ${project.health}%\n`;
      prompt += `Status: ${project.status}\n`;
      prompt += `Team: ${project.team.join(", ")}\n`;

      const projectTasks = context.tasks.filter(
        (t) => t.projectId === project.id
      );
      const openTasks = projectTasks.filter((t) => t.status !== "done");
      const blockedTasks = projectTasks.filter((t) => t.status === "blocked");

      prompt += `\nTasks: ${projectTasks.length} total, ${openTasks.length} open, ${blockedTasks.length} blocked\n`;

      if (blockedTasks.length > 0) {
        prompt += `\nBlocked tasks:\n`;
        blockedTasks.slice(0, 3).forEach((t) => {
          prompt += `- ${t.title}: ${t.blockedReason || "No reason"}\n`;
        });
      }
    }

    // Add portfolio context if available
    if (context.projects.length > 1) {
      const atRiskProjects = context.projects.filter(
        (p) => p.status === "at-risk"
      );
      prompt += `\nPortfolio: ${context.projects.length} projects, ${atRiskProjects.length} at risk\n`;
    }

    // Add recent risks
    const openRisks = context.risks.filter((r) => r.status === "open");
    if (openRisks.length > 0) {
      prompt += `\nOpen risks: ${openRisks.length}\n`;
      openRisks.slice(0, 3).forEach((r) => {
        prompt += `- ${r.title} (P${r.probability}/I${r.impact})\n`;
      });
    }

    return prompt;
  }

  private buildFinalRun(
    runId: string,
    input: AIRunInput,
    result: string,
    providerName: ProviderName
  ): AIRunRecord {
    // Try to parse JSON response
    let parsed;
    try {
      // Extract JSON from response (might have markdown code blocks)
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = { summary: result };
      }
    } catch {
      parsed = { summary: result };
    }

    const timestamp = new Date().toISOString();

    return {
      id: runId,
      agentId: input.agent.id,
      title: input.quickAction?.id || "AI Analysis",
      prompt: input.prompt,
      quickActionId: input.quickAction?.id,
      status: "done",
      createdAt: timestamp,
      updatedAt: timestamp,
      context: input.context.activeContext,
      result: {
        title: input.quickAction?.id || "AI Analysis",
        summary: parsed.summary || result,
        highlights: parsed.highlights || [],
        nextSteps: parsed.nextSteps || [],
        proposal: null, // Provider adapter doesn't create proposals
      },
    };
  }

  private buildFailedRun(
    runId: string,
    input: AIRunInput,
    run: AIRunRecord,
    error: unknown
  ): AIRunRecord {
    const timestamp = new Date().toISOString();
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : (error as { message?: string } | null)?.message ?? "AI provider run failed";

    return {
      ...run,
      id: runId,
      title: input.quickAction?.id || "AI Analysis",
      status: "failed",
      updatedAt: timestamp,
      errorMessage: message,
    };
  }

  async getRun(runId: string): Promise<AIRunRecord> {
    const entry = this.runStore.get(runId);
    if (!entry) {
      throw new Error(`AI run ${runId} not found`);
    }

    const elapsed = Date.now() - entry.startedAt;

    // If less than 500ms, show queued
    if (elapsed < 500) {
      return {
        ...entry.run,
        status: "queued",
        updatedAt: new Date().toISOString(),
      };
    }

    // If less than 2s, show running
    if (elapsed < 2000) {
      return {
        ...entry.run,
        status: "running",
        updatedAt: new Date().toISOString(),
      };
    }

    // Return final result if available
    if (entry.finalRun) {
      return entry.finalRun;
    }

    // Still running
    return {
      ...entry.run,
      status: "running",
      updatedAt: new Date().toISOString(),
    };
  }

  async applyProposal(input: AIApplyProposalInput): Promise<AIRunRecord> {
    const entry = this.runStore.get(input.runId);
    if (!entry) {
      throw new Error(`AI run ${input.runId} not found`);
    }

    // Delegate to mock adapter for proposal application
    // (Provider adapter doesn't create proposals, only analysis)
    return this.mockAdapter.applyProposal(input);
  }
}

// Export factory function
export function createProviderAdapter(options?: {
  priority?: ProviderName[];
  timeout?: number;
}): ProviderAdapter {
  return new ProviderAdapter(options);
}

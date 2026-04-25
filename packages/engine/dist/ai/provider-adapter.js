/**
 * Russian AI Provider Adapter
 *
 * Supports: AIJora, Polza.ai, OpenRouter, Bothub, OpenAI
 * OpenAI-compatible API with fallback chain
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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import OpenAI from "openai";
import { attachRunGrounding } from './grounding.js';
import { createMockAIAdapter } from './mock-adapter.js';
import { logger } from '../observability/logger.js';
import { loadConfiguredAIProviderManifests, } from './provider-manifests.js';
// Provider configuration
const BUILTIN_PROVIDERS = [
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
function loadConfiguredProviders(env = process.env) {
    var _a;
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
            models: (_a = manifest.models) !== null && _a !== void 0 ? _a : [manifest.defaultModel],
            source: "manifest",
        });
    }
    return providers;
}
// ─── Provider Availability Check ───────────────────────────────────────────
function getAvailableProviders() {
    const providers = loadConfiguredProviders().filter((p) => {
        // Local model doesn't need API key, just check if server is running
        if (p.name === "local-model") {
            return true; // Will be checked at runtime
        }
        if (!p.envKey)
            return false;
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
export function hasAvailableProviders() {
    return getAvailableProviders().length > 0;
}
// ───────────────────────────────────────────────────────────────────────────
// Error types
class ProviderError extends Error {
    constructor(provider, statusCode, message) {
        super(`[${provider}] ${message}`);
        this.provider = provider;
        this.statusCode = statusCode;
        this.name = "ProviderError";
    }
}
class InsufficientFundsError extends ProviderError {
    constructor(provider) {
        super(provider, 402, "Insufficient funds");
        this.name = "InsufficientFundsError";
    }
}
class RateLimitError extends ProviderError {
    constructor(provider) {
        super(provider, 429, "Rate limit exceeded");
        this.name = "RateLimitError";
    }
}
// Provider adapter implementation
export class ProviderAdapter {
    constructor(options) {
        this.mode = "provider";
        this.runStore = new Map();
        this.priority = (options === null || options === void 0 ? void 0 : options.priority) || this.getDefaultPriority();
        this.timeout = (options === null || options === void 0 ? void 0 : options.timeout) || 30000; // 30s default
        this.mockAdapter = createMockAIAdapter();
    }
    getDefaultPriority() {
        const envPriority = process.env.AI_PROVIDER_PRIORITY;
        if (envPriority) {
            return envPriority.split(",").filter((p) => loadConfiguredProviders().some((prov) => prov.name === p));
        }
        return loadConfiguredProviders().map((provider) => provider.name);
    }
    getProvider(name) {
        return loadConfiguredProviders().find((p) => p.name === name);
    }
    isProviderAvailable(name) {
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
    createRunId() {
        if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
            return `ai-run-${crypto.randomUUID()}`;
        }
        return `ai-run-${Math.random().toString(36).slice(2, 10)}`;
    }
    runAgent(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const { signal } = input, restInput = __rest(input, ["signal"]);
            const now = new Date().toISOString();
            const runId = this.createRunId();
            // Create initial run record
            const run = {
                id: runId,
                agentId: input.agent.id,
                title: "AI Provider Run",
                prompt: input.prompt,
                quickActionId: (_a = input.quickAction) === null || _a === void 0 ? void 0 : _a.id,
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
        });
    }
    executeWithProviders(runId, input, signal) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const errors = [];
            const attemptedProviders = [];
            for (const providerName of this.priority) {
                // Check if aborted
                if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
                    throw new Error("Request aborted");
                }
                if (!this.isProviderAvailable(providerName)) {
                    logger.debug("Provider not available (no API key)", { provider: providerName });
                    continue;
                }
                try {
                    logger.info("Trying AI provider", { provider: providerName });
                    attemptedProviders.push(providerName);
                    const result = yield this.tryProvider(providerName, input, signal);
                    logger.info("Provider succeeded", { provider: providerName });
                    // Update run store with result
                    const entry = this.runStore.get(runId);
                    if (entry) {
                        entry.finalRun = this.buildFinalRun(runId, input, result, providerName);
                    }
                    return;
                }
                catch (error) {
                    logger.warn("Provider failed", { provider: providerName, error: error instanceof Error ? error.message : String(error) });
                    errors.push(error);
                    // Don't retry on auth/funds errors
                    if (error instanceof InsufficientFundsError ||
                        error.statusCode === 401) {
                        continue;
                    }
                    // Wait 1s on rate limit, then try next
                    if (error instanceof RateLimitError) {
                        yield new Promise((resolve) => setTimeout(resolve, 1000));
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
                    message: attemptedProviders.length > 0
                        ? `All attempted AI providers failed: ${attemptedProviders.join(", ")}${errors.length > 0 ? `. Last error: ${(_b = (_a = errors[errors.length - 1]) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : "Unknown error"}` : ""}`
                        : "No configured AI providers were available.",
                });
            }
        });
    }
    tryProvider(providerName, input, signal) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
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
                const response = yield client.chat.completions.create({
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
                }, {
                    signal,
                });
                const content = ((_b = (_a = response.choices[0]) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.content) || "";
                return content;
            }
            catch (error) {
                const err = error;
                // Classify errors
                if (err.status === 401 || err.status === 403) {
                    throw new ProviderError(providerName, err.status, "Authentication failed");
                }
                if (err.status === 402) {
                    throw new InsufficientFundsError(providerName);
                }
                if (err.status === 429) {
                    throw new RateLimitError(providerName);
                }
                // Re-throw with context
                throw new ProviderError(providerName, err.status || 500, err.message || "Unknown error");
            }
        });
    }
    buildSystemPrompt(input) {
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
    buildUserPrompt(input) {
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
            const projectTasks = context.tasks.filter((t) => t.projectId === project.id);
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
            const atRiskProjects = context.projects.filter((p) => p.status === "at-risk");
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
    buildFinalRun(runId, input, result, _providerName) {
        var _a, _b, _c;
        // Try to parse JSON response
        let parsed;
        try {
            // Extract JSON from response (might have markdown code blocks)
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            }
            else {
                parsed = { summary: result };
            }
        }
        catch (_d) {
            parsed = { summary: result };
        }
        const timestamp = new Date().toISOString();
        return {
            id: runId,
            agentId: input.agent.id,
            title: ((_a = input.quickAction) === null || _a === void 0 ? void 0 : _a.id) || "AI Analysis",
            prompt: input.prompt,
            quickActionId: (_b = input.quickAction) === null || _b === void 0 ? void 0 : _b.id,
            status: "done",
            createdAt: timestamp,
            updatedAt: timestamp,
            context: input.context.activeContext,
            result: attachRunGrounding({
                title: ((_c = input.quickAction) === null || _c === void 0 ? void 0 : _c.id) || "AI Analysis",
                summary: parsed.summary || result,
                highlights: parsed.highlights || [],
                nextSteps: parsed.nextSteps || [],
                proposal: null, // Provider adapter doesn't create proposals
            }, input),
        };
    }
    buildFailedRun(runId, input, run, error) {
        var _a, _b;
        const timestamp = new Date().toISOString();
        const message = error instanceof Error
            ? error.message
            : typeof error === "string"
                ? error
                : (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : "AI provider run failed";
        return Object.assign(Object.assign({}, run), { id: runId, title: ((_b = input.quickAction) === null || _b === void 0 ? void 0 : _b.id) || "AI Analysis", status: "failed", updatedAt: timestamp, errorMessage: message });
    }
    getRun(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            const entry = this.runStore.get(runId);
            if (!entry) {
                throw new Error(`AI run ${runId} not found`);
            }
            const elapsed = Date.now() - entry.startedAt;
            // If less than 500ms, show queued
            if (elapsed < 500) {
                return Object.assign(Object.assign({}, entry.run), { status: "queued", updatedAt: new Date().toISOString() });
            }
            // If less than 2s, show running
            if (elapsed < 2000) {
                return Object.assign(Object.assign({}, entry.run), { status: "running", updatedAt: new Date().toISOString() });
            }
            // Return final result if available
            if (entry.finalRun) {
                return entry.finalRun;
            }
            // Still running
            return Object.assign(Object.assign({}, entry.run), { status: "running", updatedAt: new Date().toISOString() });
        });
    }
    applyProposal(input) {
        return __awaiter(this, void 0, void 0, function* () {
            const entry = this.runStore.get(input.runId);
            if (!entry) {
                throw new Error(`AI run ${input.runId} not found`);
            }
            // Delegate to mock adapter for proposal application
            // (Provider adapter doesn't create proposals, only analysis)
            return this.mockAdapter.applyProposal(input);
        });
    }
}
// Export factory function
export function createProviderAdapter(options) {
    return new ProviderAdapter(options);
}

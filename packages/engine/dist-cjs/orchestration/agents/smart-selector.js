"use strict";
/**
 * Smart Agent Selector — hybrid router that picks a built-in agent ID
 * for a natural-language task.
 *
 * Two modes are supported:
 *
 *   1. `selectAgent(task)` — synchronous regex-baseline. Fast, zero
 *      dependencies, always safe to call at the edge. Returns
 *      `"main"` when no bucket fires.
 *
 *   2. `selectAgentAsync(task, { router, provider?, model? })` —
 *      asynchronous hybrid. Tries the regex first; when that returns
 *      `"main"` (i.e. the heuristic is unsure) it asks a fast LLM to
 *      classify the task into one of the known agent IDs. On any
 *      failure (router down, malformed JSON, unknown ID) we fall back
 *      to the regex verdict so the caller is never worse off than the
 *      pre-Wave-G behaviour.
 *
 * Extracted from the retired `lib/agents/agent-improvements.ts` in
 * Wave F; LLM fallback added in Wave G.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.smartSelector = exports.SmartAgentSelector = exports.KNOWN_AGENT_IDS = void 0;
const logger_1 = require("../../observability/logger");
exports.KNOWN_AGENT_IDS = [
    "main",
    "quick-research",
    "quick-coder",
    "writer",
    "planner",
    "main-reviewer",
    "main-worker",
];
class SmartAgentSelector {
    /**
     * Select best agent for a task based on keyword heuristics. Returns
     * `"main"` when no bucket fires.
     */
    selectAgent(task) {
        const taskLower = task.toLowerCase();
        if (/найди|поиск|research|google|информация|что такое|кто такой/.test(taskLower)) {
            return "quick-research";
        }
        if (/код|программ|bug|исправь|рефактор|функция|скрипт|код/.test(taskLower)) {
            return "quick-coder";
        }
        if (/напиши|текст|документ|отчёт|статья|письмо/.test(taskLower)) {
            return "writer";
        }
        if (/план|расписание|срок|задача|roadmap|приоритет/.test(taskLower)) {
            return "planner";
        }
        if (/проверь|review|оценка|критика|качество|error/.test(taskLower)) {
            return "main-reviewer";
        }
        return "main";
    }
    /**
     * Hybrid selector: regex first, LLM classifier when the heuristic
     * returns the generic `"main"` bucket. Always resolves to a known
     * agent id; on any error the regex verdict is used.
     */
    async selectAgentAsync(task, options) {
        const heuristic = this.selectAgent(task);
        if (heuristic !== "main")
            return heuristic;
        const { router, provider, model, workspaceId, timeoutMs = 4000 } = options;
        const providers = router.getAvailableProviders();
        if (providers.length === 0)
            return "main";
        const targetProvider = provider && providers.includes(provider) ? provider : providers[0];
        const systemPrompt = `You are a routing classifier. Read the user's task and respond with STRICT JSON: {"agentId":"<id>"}. Valid ids are: ${exports.KNOWN_AGENT_IDS.join(", ")}. Pick the single best id. Do not explain.`;
        try {
            const raw = await this.withTimeout(router.chat([
                { role: "system", content: systemPrompt },
                { role: "user", content: task.slice(0, 2000) },
            ], {
                provider: targetProvider,
                model,
                workspaceId,
                agentId: "smart-selector",
            }), timeoutMs);
            const parsed = this.parseLlmVerdict(raw);
            if (parsed && exports.KNOWN_AGENT_IDS.includes(parsed)) {
                return parsed;
            }
            logger_1.logger.info("smart-selector: LLM returned unknown agent id, using heuristic", {
                raw: raw.slice(0, 200),
            });
            return heuristic;
        }
        catch (err) {
            logger_1.logger.warn("smart-selector: LLM fallback failed", {
                error: err instanceof Error ? err.message : String(err),
            });
            return heuristic;
        }
    }
    async withTimeout(promise, timeoutMs) {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`smart-selector: LLM timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    }
    /**
     * Tolerate a range of LLM formats: strict JSON, fenced code blocks,
     * or a bare `agentId` string. Returns the extracted id or null.
     */
    parseLlmVerdict(raw) {
        if (!raw)
            return null;
        const text = raw.trim();
        // Strip ```json fences if present.
        const stripped = text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/```$/i, "")
            .trim();
        try {
            const parsed = JSON.parse(stripped);
            if (parsed && typeof parsed === "object" && typeof parsed.agentId === "string") {
                return parsed.agentId.trim();
            }
        }
        catch {
            // fall through to regex extraction
        }
        const match = stripped.match(/"agentId"\s*:\s*"([^"]+)"/i);
        if (match)
            return match[1];
        const bare = stripped.match(/^(main|quick-research|quick-coder|writer|planner|main-reviewer|main-worker)$/i);
        if (bare)
            return bare[1].toLowerCase();
        return null;
    }
    getAgentCapabilities(agentId) {
        const capabilities = {
            main: ["orchestration", "communication", "delegation"],
            "quick-research": ["web-search", "analysis", "summarization"],
            "quick-coder": ["code-generation", "debugging", "refactoring"],
            writer: ["content-creation", "documentation", "translation"],
            planner: ["task-planning", "estimation", "resource-allocation"],
            "main-reviewer": ["quality-check", "error-detection", "feedback"],
            "main-worker": ["execution", "file-operations", "script-running"],
        };
        return capabilities[agentId] ?? capabilities.main;
    }
}
exports.SmartAgentSelector = SmartAgentSelector;
exports.smartSelector = new SmartAgentSelector();

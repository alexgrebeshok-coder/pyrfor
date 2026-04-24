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
import type { AIRouter } from '../../ai/providers';
export declare const KNOWN_AGENT_IDS: readonly ["main", "quick-research", "quick-coder", "writer", "planner", "main-reviewer", "main-worker"];
export type KnownAgentId = (typeof KNOWN_AGENT_IDS)[number];
export interface LlmSelectOptions {
    /** Router used to call the classifier. Required. */
    router: AIRouter;
    /** Preferred provider (defaults to the first available). */
    provider?: string;
    /** Preferred model hint. Forwarded to the router's ChatOptions. */
    model?: string;
    /** Workspace for cost attribution. */
    workspaceId?: string;
    /** Timeout in ms for the classifier call. Defaults to 4 s. */
    timeoutMs?: number;
}
export declare class SmartAgentSelector {
    /**
     * Select best agent for a task based on keyword heuristics. Returns
     * `"main"` when no bucket fires.
     */
    selectAgent(task: string): string;
    /**
     * Hybrid selector: regex first, LLM classifier when the heuristic
     * returns the generic `"main"` bucket. Always resolves to a known
     * agent id; on any error the regex verdict is used.
     */
    selectAgentAsync(task: string, options: LlmSelectOptions): Promise<KnownAgentId>;
    private withTimeout;
    /**
     * Tolerate a range of LLM formats: strict JSON, fenced code blocks,
     * or a bare `agentId` string. Returns the extracted id or null.
     */
    parseLlmVerdict(raw: string): string | null;
    getAgentCapabilities(agentId: string): string[];
}
export declare const smartSelector: SmartAgentSelector;
//# sourceMappingURL=smart-selector.d.ts.map
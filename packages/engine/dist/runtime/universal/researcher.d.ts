/**
 * researcher.ts — M6 Universal Engine OODA Research Loop
 *
 * `UniversalResearcher` executes evidence-gathering for one research topic
 * at a time using an OODA (Observe–Orient–Decide–Act) loop bounded by
 * `maxLoops` (default: 3).
 *
 * ## OODA Loop
 *
 *   Observe  — Run a governed search query via `runGovernedResearchSearch`.
 *   Orient   — Parse results; identify facts not yet seen in previous iterations.
 *   Decide   — Continue if new facts were found AND iterations < maxLoops.
 *   Act      — Accumulate facts and source URLs; build the next query if looping.
 *
 * Termination conditions:
 *   - `max_loops`        — maxLoops iterations completed (hard bound).
 *   - `converged`        — An iteration found zero new facts (stable state).
 *   - `offline_fallback` — No search provider is configured; returns empty result
 *                          immediately without any network call.
 *
 * ## Offline Fallback
 * When no search provider is configured (`BRAVE_API_KEY` absent and
 * `PYRFOR_RESEARCH_SEARCH_PROVIDER` not set), `UniversalResearcher` returns a
 * `ResearchResult` with `offline: true`, `facts: []`, and
 * `stoppedAt: 'offline_fallback'` — no error is thrown.
 *
 * ## No ToolForge / No Orchestrator
 * This module has no dependency on tool-forge, engine-loop, or gateway.
 * It is a standalone research unit designed for composition.
 */
import type { ArtifactRef, ArtifactStore } from '../artifact-model';
export interface OodaIteration {
    /** Zero-based iteration index. */
    iteration: number;
    topic: string;
    /** The search query used in the Observe step. */
    query: string;
    /** Total sources returned by the search provider. */
    sourcesFound: number;
    /** Facts in this iteration that were not seen before. */
    newFactsLearned: number;
    /** Whether the loop decided to continue after this iteration. */
    continueLoop: boolean;
    /** Why the loop stopped, if this was the final iteration. */
    stopReason?: 'max_loops' | 'converged';
}
export interface ResearchResult {
    topic: string;
    iterations: OodaIteration[];
    /** Deduplicated list of facts gathered across all iterations. */
    facts: string[];
    /** Deduplicated source URLs cited as evidence. */
    sourceRefs: string[];
    stoppedAt: 'max_loops' | 'converged' | 'offline_fallback';
    /** True when no search provider was available; facts will be empty. */
    offline: boolean;
}
export interface UniversalResearcherDeps {
    artifactStore: ArtifactStore;
    /**
     * Process environment used to resolve the search provider.
     * Defaults to `process.env`.
     */
    env?: NodeJS.ProcessEnv;
    /**
     * Injectable fetch implementation.
     * Defaults to `globalThis.fetch`.
     */
    fetchImpl?: typeof fetch;
    /**
     * Maximum OODA iterations per research call.
     * Default: 3.  Hard ceiling: 10.
     */
    maxLoops?: number;
}
/**
 * Execute a bounded OODA research loop for a single topic.
 *
 * @example
 * ```ts
 * const researcher = new UniversalResearcher({ artifactStore });
 * const ref = await researcher.research('TypeScript generics patterns', 'run-abc');
 * const result = await artifactStore.readJSON<ResearchResult>(ref);
 * console.log(result.facts);
 * ```
 */
export declare class UniversalResearcher {
    private readonly deps;
    private readonly maxLoops;
    constructor(deps: UniversalResearcherDeps);
    /**
     * Research a topic and persist a `ResearchResult` artifact.
     *
     * @param topic  Natural-language research topic.
     * @param runId  Run identifier used as the artifact bucket.
     * @returns ArtifactRef pointing to a `research_source_capture` JSON artifact.
     */
    research(topic: string, runId: string): Promise<ArtifactRef>;
    private writeResult;
}
//# sourceMappingURL=researcher.d.ts.map
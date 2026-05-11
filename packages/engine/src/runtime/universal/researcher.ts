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
import {
  runGovernedResearchSearch,
  resolveGovernedResearchSearchProvider,
} from '../research-search';

// ─── Public Types ────────────────────────────────────────────────────────────

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

// ─── Query Builder ───────────────────────────────────────────────────────────

const MAX_LOOPS_HARD_CAP = 10;

/**
 * Build the search query for iteration `i`.
 * Later iterations narrow the query using facts already found to avoid
 * redundant results (Orient → Decide → Act refinement).
 */
function buildQuery(topic: string, iteration: number, seenFacts: string[]): string {
  if (iteration === 0 || seenFacts.length === 0) return topic;
  // Second pass: refine by appending a contrasting keyword from existing facts
  // to steer the search toward unexplored territory.
  const lastFact = seenFacts.at(-1) ?? '';
  const firstWords = lastFact.split(/\s+/).slice(0, 3).join(' ');
  return firstWords ? `${topic} -"${firstWords}"` : topic;
}

/**
 * Extract a short, stable fact string from a raw search snippet.
 * Trims whitespace and truncates to 200 characters.
 */
function extractFact(value: string): string {
  return value.trim().slice(0, 200);
}

// ─── UniversalResearcher ─────────────────────────────────────────────────────

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
export class UniversalResearcher {
  private readonly deps: UniversalResearcherDeps;
  private readonly maxLoops: number;

  constructor(deps: UniversalResearcherDeps) {
    this.deps = deps;
    const requested = deps.maxLoops ?? 3;
    this.maxLoops = Math.min(Math.max(1, requested), MAX_LOOPS_HARD_CAP);
  }

  /**
   * Research a topic and persist a `ResearchResult` artifact.
   *
   * @param topic  Natural-language research topic.
   * @param runId  Run identifier used as the artifact bucket.
   * @returns ArtifactRef pointing to a `research_source_capture` JSON artifact.
   */
  async research(topic: string, runId: string): Promise<ArtifactRef> {
    if (!topic.trim()) throw new Error('researcher: topic must not be empty');

    const env = this.deps.env ?? process.env;

    // ── Offline check ─────────────────────────────────────────────────────
    let offline = false;
    try {
      const provider = resolveGovernedResearchSearchProvider(env);
      if (provider === 'brave' && !env['BRAVE_API_KEY']?.trim()) offline = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('unsupported provider')) throw err;
      offline = true;
    }

    if (offline) {
      return this.writeResult(
        {
          topic,
          iterations: [],
          facts: [],
          sourceRefs: [],
          stoppedAt: 'offline_fallback',
          offline: true,
        },
        runId,
      );
    }

    // ── OODA loop ─────────────────────────────────────────────────────────
    const iterations: OodaIteration[] = [];
    const facts: string[] = [];
    const sourceRefs: string[] = [];
    let stoppedAt: ResearchResult['stoppedAt'] = 'max_loops';

    for (let i = 0; i < this.maxLoops; i++) {
      // Observe
      const query = buildQuery(topic, i, facts);
      let searchResult: Awaited<ReturnType<typeof runGovernedResearchSearch>>;

      try {
        searchResult = await runGovernedResearchSearch(
          { query, maxResults: 3 },
          { env, fetchImpl: this.deps.fetchImpl },
        );
      } catch {
        // Search failure — treat as convergence and exit loop cleanly
        iterations.push({
          iteration: i,
          topic,
          query,
          sourcesFound: 0,
          newFactsLearned: 0,
          continueLoop: false,
          stopReason: 'converged',
        });
        stoppedAt = 'converged';
        break;
      }

      // Orient — extract candidate facts and collect source URLs
      const candidates: string[] = searchResult.results.flatMap((r) => {
        const candidates: string[] = [];
        if (r.snippet) candidates.push(extractFact(r.snippet));
        else if (r.title) candidates.push(extractFact(r.title));
        if (r.url) sourceRefs.push(r.url);
        return candidates;
      });

      const newFacts = candidates.filter((f) => f.length > 0 && !facts.includes(f));

      // Decide — continue only when new facts exist and budget remains
      const hasMoreIterations = i + 1 < this.maxLoops;
      const continueLoop = newFacts.length > 0 && hasMoreIterations;

      const iteration: OodaIteration = {
        iteration: i,
        topic,
        query,
        sourcesFound: searchResult.results.length,
        newFactsLearned: newFacts.length,
        continueLoop,
        ...(!continueLoop
          ? { stopReason: newFacts.length === 0 ? ('converged' as const) : ('max_loops' as const) }
          : {}),
      };
      iterations.push(iteration);

      // Act — accumulate facts
      facts.push(...newFacts);

      if (!continueLoop) {
        stoppedAt = newFacts.length === 0 ? 'converged' : 'max_loops';
        break;
      }
    }

    return this.writeResult(
      {
        topic,
        iterations,
        facts,
        sourceRefs: [...new Set(sourceRefs)],
        stoppedAt,
        offline: false,
      },
      runId,
    );
  }

  private async writeResult(result: ResearchResult, runId: string): Promise<ArtifactRef> {
    return this.deps.artifactStore.writeJSON('research_source_capture', result, { runId });
  }
}

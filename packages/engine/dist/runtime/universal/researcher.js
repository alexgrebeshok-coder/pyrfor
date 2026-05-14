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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { runGovernedResearchSearch, resolveGovernedResearchSearchProvider, } from '../research-search.js';
// ─── Query Builder ───────────────────────────────────────────────────────────
const MAX_LOOPS_HARD_CAP = 10;
/**
 * Build the search query for iteration `i`.
 * Later iterations narrow the query using facts already found to avoid
 * redundant results (Orient → Decide → Act refinement).
 */
function buildQuery(topic, iteration, seenFacts) {
    var _a;
    if (iteration === 0 || seenFacts.length === 0)
        return topic;
    // Second pass: refine by appending a contrasting keyword from existing facts
    // to steer the search toward unexplored territory.
    const lastFact = (_a = seenFacts.at(-1)) !== null && _a !== void 0 ? _a : '';
    const firstWords = lastFact.split(/\s+/).slice(0, 3).join(' ');
    return firstWords ? `${topic} -"${firstWords}"` : topic;
}
/**
 * Extract a short, stable fact string from a raw search snippet.
 * Trims whitespace and truncates to 200 characters.
 */
function extractFact(value) {
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
    constructor(deps) {
        var _a;
        this.deps = deps;
        const requested = (_a = deps.maxLoops) !== null && _a !== void 0 ? _a : 3;
        this.maxLoops = Math.min(Math.max(1, requested), MAX_LOOPS_HARD_CAP);
    }
    /**
     * Research a topic and persist a `ResearchResult` artifact.
     *
     * @param topic  Natural-language research topic.
     * @param runId  Run identifier used as the artifact bucket.
     * @returns ArtifactRef pointing to a `research_source_capture` JSON artifact.
     */
    research(topic, runId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            if (!topic.trim())
                throw new Error('researcher: topic must not be empty');
            const env = (_a = this.deps.env) !== null && _a !== void 0 ? _a : process.env;
            // ── Offline check ─────────────────────────────────────────────────────
            let offline = false;
            try {
                const provider = resolveGovernedResearchSearchProvider(env);
                if (provider === 'brave' && !((_b = env['BRAVE_API_KEY']) === null || _b === void 0 ? void 0 : _b.trim()))
                    offline = true;
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (message.includes('unsupported provider'))
                    throw err;
                offline = true;
            }
            if (offline) {
                return this.writeResult({
                    topic,
                    iterations: [],
                    facts: [],
                    sourceRefs: [],
                    stoppedAt: 'offline_fallback',
                    offline: true,
                }, runId);
            }
            // ── OODA loop ─────────────────────────────────────────────────────────
            const iterations = [];
            const facts = [];
            const sourceRefs = [];
            let stoppedAt = 'max_loops';
            for (let i = 0; i < this.maxLoops; i++) {
                // Observe
                const query = buildQuery(topic, i, facts);
                let searchResult;
                try {
                    searchResult = yield runGovernedResearchSearch({ query, maxResults: 3 }, { env, fetchImpl: this.deps.fetchImpl });
                }
                catch (_c) {
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
                const candidates = searchResult.results.flatMap((r) => {
                    const candidates = [];
                    if (r.snippet)
                        candidates.push(extractFact(r.snippet));
                    else if (r.title)
                        candidates.push(extractFact(r.title));
                    if (r.url)
                        sourceRefs.push(r.url);
                    return candidates;
                });
                const newFacts = candidates.filter((f) => f.length > 0 && !facts.includes(f));
                // Decide — continue only when new facts exist and budget remains
                const hasMoreIterations = i + 1 < this.maxLoops;
                const continueLoop = newFacts.length > 0 && hasMoreIterations;
                const iteration = Object.assign({ iteration: i, topic,
                    query, sourcesFound: searchResult.results.length, newFactsLearned: newFacts.length, continueLoop }, (!continueLoop
                    ? { stopReason: newFacts.length === 0 ? 'converged' : 'max_loops' }
                    : {}));
                iterations.push(iteration);
                // Act — accumulate facts
                facts.push(...newFacts);
                if (!continueLoop) {
                    stoppedAt = newFacts.length === 0 ? 'converged' : 'max_loops';
                    break;
                }
            }
            return this.writeResult({
                topic,
                iterations,
                facts,
                sourceRefs: [...new Set(sourceRefs)],
                stoppedAt,
                offline: false,
            }, runId);
        });
    }
    writeResult(result, runId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.deps.artifactStore.writeJSON('research_source_capture', result, { runId });
        });
    }
}

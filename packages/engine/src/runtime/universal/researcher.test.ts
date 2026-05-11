/**
 * researcher.test.ts — Deterministic tests for UniversalResearcher.
 *
 * All tests are fully deterministic: no real network requests.
 * Search calls are intercepted by a `fetchImpl` mock.
 * File I/O uses a temporary directory created and destroyed per test.
 *
 * Coverage:
 *  - Offline fallback (no search provider configured)
 *  - OODA loop terminates at maxLoops (bounded property)
 *  - OODA loop converges when no new facts are found
 *  - Facts are accumulated across iterations
 *  - Source URLs are deduplicated
 *  - Empty topic throws
 *  - ResearchResult artifact is written with kind 'research_source_capture'
 *  - Artifact content matches the returned ResearchResult
 *  - Hard cap: maxLoops is clamped to MAX_LOOPS_HARD_CAP (10)
 *  - Search failure → converged (no throw)
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from '../artifact-model';
import { UniversalResearcher, type ResearchResult } from './researcher';

// ─── Test Setup ───────────────────────────────────────────────────────────────

let dir: string;
let artifactStore: ArtifactStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-researcher-test-'));
  artifactStore = new ArtifactStore({ rootDir: dir });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ─── DuckDuckGo Mock Factory ──────────────────────────────────────────────────

/**
 * Build a `fetchImpl` mock that returns a DuckDuckGo-formatted JSON response.
 * `factFn` is called with the call index to allow returning distinct facts per call.
 */
function duckduckgoFetch(factFn: (callIndex: number) => string): typeof fetch {
  let calls = 0;
  return vi.fn().mockImplementation(async () => {
    const text = factFn(calls++);
    return {
      ok: true,
      json: async () => ({
        AbstractText: text,
        AbstractURL: `https://example.com/${calls}`,
        Heading: `Result ${calls}`,
        RelatedTopics: [],
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** A fetch mock whose responses always return the same fact (causes convergence). */
function fixedFactFetch(fact: string): typeof fetch {
  return duckduckgoFetch(() => fact);
}

/** A fetch mock that always produces a unique fact per call (prevents convergence). */
function evergreenFetch(): typeof fetch {
  let n = 0;
  return duckduckgoFetch(() => `Fact number ${++n} that is unique and novel`);
}

/** A fetch mock that always throws a network error. */
function failingFetch(): typeof fetch {
  return vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
}

/** Env with DuckDuckGo configured. */
const DDG_ENV: NodeJS.ProcessEnv = { PYRFOR_RESEARCH_SEARCH_PROVIDER: 'duckduckgo' };
/** Env with no provider configured. */
const NO_PROVIDER_ENV: NodeJS.ProcessEnv = {};

// ─── Offline Fallback ────────────────────────────────────────────────────────

describe('researcher offline fallback', () => {
  it('returns offline result when no search provider is configured', async () => {
    const researcher = new UniversalResearcher({ artifactStore, env: NO_PROVIDER_ENV });
    const ref = await researcher.research('TypeScript generics', 'run-offline');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    expect(result.offline).toBe(true);
    expect(result.stoppedAt).toBe('offline_fallback');
    expect(result.facts).toEqual([]);
    expect(result.sourceRefs).toEqual([]);
    expect(result.iterations).toHaveLength(0);
  });

  it('offline result artifact has correct kind', async () => {
    const researcher = new UniversalResearcher({ artifactStore, env: NO_PROVIDER_ENV });
    const ref = await researcher.research('Topic', 'run-offline-kind');

    expect(ref.kind).toBe('research_source_capture');
  });

  it('offline result has the correct topic', async () => {
    const researcher = new UniversalResearcher({ artifactStore, env: NO_PROVIDER_ENV });
    const ref = await researcher.research('Redis caching strategies', 'run-topic');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    expect(result.topic).toBe('Redis caching strategies');
  });

  it('does not call fetchImpl when offline', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const researcher = new UniversalResearcher({
      artifactStore,
      env: NO_PROVIDER_ENV,
      fetchImpl,
    });
    await researcher.research('Topic', 'run-no-fetch');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws on unsupported search provider instead of treating it as offline', async () => {
    const researcher = new UniversalResearcher({
      artifactStore,
      env: { PYRFOR_RESEARCH_SEARCH_PROVIDER: 'google' },
    });

    await expect(researcher.research('Topic', 'run-bad-provider')).rejects.toThrow(/unsupported provider/);
  });

  it('returns offline fallback when Brave is selected without BRAVE_API_KEY', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const researcher = new UniversalResearcher({
      artifactStore,
      env: { PYRFOR_RESEARCH_SEARCH_PROVIDER: 'brave' },
      fetchImpl,
    });

    const ref = await researcher.research('Topic', 'run-brave-no-key');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    expect(result.offline).toBe(true);
    expect(result.stoppedAt).toBe('offline_fallback');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ─── OODA Loop Bounded ───────────────────────────────────────────────────────

describe('OODA loop bounded by maxLoops', () => {
  it('performs exactly maxLoops search calls when facts are always fresh', async () => {
    const fetchImpl = evergreenFetch();
    const researcher = new UniversalResearcher({
      artifactStore,
      env: DDG_ENV,
      fetchImpl,
      maxLoops: 3,
    });

    const ref = await researcher.research('TypeScript generics', 'run-max-loops');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    expect(result.iterations).toHaveLength(3);
    expect(result.stoppedAt).toBe('max_loops');
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(3);
  });

  it('maxLoops=1 performs a single search and stops', async () => {
    const fetchImpl = evergreenFetch();
    const researcher = new UniversalResearcher({
      artifactStore,
      env: DDG_ENV,
      fetchImpl,
      maxLoops: 1,
    });

    const ref = await researcher.research('Topic', 'run-single');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    expect(result.iterations).toHaveLength(1);
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1);
  });

  it('maxLoops above hard cap (10) is clamped to 10', async () => {
    const fetchImpl = evergreenFetch();
    const researcher = new UniversalResearcher({
      artifactStore,
      env: DDG_ENV,
      fetchImpl,
      maxLoops: 999,
    });

    const ref = await researcher.research('Topic', 'run-cap');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    expect(result.iterations.length).toBeLessThanOrEqual(10);
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(10);
  });
});

// ─── OODA Convergence ─────────────────────────────────────────────────────────

describe('OODA loop convergence', () => {
  it('converges when the same fact is returned on every iteration', async () => {
    const fetchImpl = fixedFactFetch('TypeScript is a typed superset of JavaScript');
    const researcher = new UniversalResearcher({
      artifactStore,
      env: DDG_ENV,
      fetchImpl,
      maxLoops: 5,
    });

    const ref = await researcher.research('TypeScript', 'run-converge');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    // First iteration finds the fact; second finds nothing new → converges
    expect(result.stoppedAt).toBe('converged');
    // Must stop well before maxLoops=5
    expect(result.iterations.length).toBeLessThan(5);
    // The fact is recorded exactly once
    const fact = 'TypeScript is a typed superset of JavaScript';
    expect(result.facts.filter((f) => f === fact)).toHaveLength(1);
  });

  it('convergence iteration has newFactsLearned: 0', async () => {
    const fetchImpl = fixedFactFetch('Same fact every time');
    const researcher = new UniversalResearcher({
      artifactStore,
      env: DDG_ENV,
      fetchImpl,
      maxLoops: 5,
    });

    const ref = await researcher.research('Topic', 'run-converge-zero');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    const lastIter = result.iterations.at(-1)!;
    expect(lastIter.newFactsLearned).toBe(0);
    expect(lastIter.stopReason).toBe('converged');
  });
});

// ─── Fact Accumulation ────────────────────────────────────────────────────────

describe('fact accumulation and deduplication', () => {
  it('accumulates distinct facts across iterations', async () => {
    const fetchImpl = evergreenFetch();
    const researcher = new UniversalResearcher({
      artifactStore,
      env: DDG_ENV,
      fetchImpl,
      maxLoops: 3,
    });

    const ref = await researcher.research('Node.js patterns', 'run-facts');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    // 3 iterations × 1 unique fact each = 3 unique facts
    expect(result.facts).toHaveLength(3);
  });

  it('deduplicates source URLs', async () => {
    // Both iterations return results with the same URL (call index 1 and 2
    // but the mock always points to /1)
    let calls = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({
          AbstractText: `unique fact ${calls}`,
          AbstractURL: 'https://example.com/same-url',  // same URL every time
          Heading: 'Same',
          RelatedTopics: [],
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const researcher = new UniversalResearcher({
      artifactStore,
      env: DDG_ENV,
      fetchImpl,
      maxLoops: 2,
    });

    const ref = await researcher.research('Topic', 'run-dedup-url');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    expect(result.sourceRefs.filter((u) => u === 'https://example.com/same-url')).toHaveLength(1);
  });
});

// ─── Search Failure Handling ──────────────────────────────────────────────────

describe('search failure handling', () => {
  it('treats search failure on first call as converged (no throw)', async () => {
    const researcher = new UniversalResearcher({
      artifactStore,
      env: DDG_ENV,
      fetchImpl: failingFetch(),
      maxLoops: 3,
    });

    // Should not throw
    const ref = await researcher.research('Topic', 'run-fail');
    const result = await artifactStore.readJSON<ResearchResult>(ref);

    expect(result.stoppedAt).toBe('converged');
    expect(result.offline).toBe(false);
  });
});

// ─── Input Validation ─────────────────────────────────────────────────────────

describe('input validation', () => {
  it('throws on empty topic', async () => {
    const researcher = new UniversalResearcher({ artifactStore, env: NO_PROVIDER_ENV });
    await expect(researcher.research('', 'run-empty')).rejects.toThrow(/topic must not be empty/);
  });

  it('throws on whitespace-only topic', async () => {
    const researcher = new UniversalResearcher({ artifactStore, env: NO_PROVIDER_ENV });
    await expect(researcher.research('   ', 'run-ws')).rejects.toThrow(/topic must not be empty/);
  });
});

// ─── Artifact Persistence ────────────────────────────────────────────────────

describe('artifact persistence', () => {
  it('artifact runId matches the provided runId', async () => {
    const researcher = new UniversalResearcher({ artifactStore, env: NO_PROVIDER_ENV });
    const ref = await researcher.research('Topic', 'my-specific-run-id');

    expect(ref.runId).toBe('my-specific-run-id');
  });

  it('artifact kind is research_source_capture', async () => {
    const researcher = new UniversalResearcher({ artifactStore, env: NO_PROVIDER_ENV });
    const ref = await researcher.research('Topic', 'run-kind-check');

    expect(ref.kind).toBe('research_source_capture');
  });

  it('artifact sha256 is present', async () => {
    const researcher = new UniversalResearcher({ artifactStore, env: NO_PROVIDER_ENV });
    const ref = await researcher.research('Topic', 'run-sha256');

    expect(ref.sha256).toBeTruthy();
    expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

import type { MemoryStore } from '../../memory-store';
import type { GovernedAlgorithm } from '../completion-gate-engine';
import type { DoubleLoopStatus, MemorySlice, NodeKind } from './types';

export interface AlgorithmAwareRetrieveRequest {
  consumer: 'strategist' | 'toolforger';
  algorithms: GovernedAlgorithm[];
  phases?: string[];
  nodeKinds?: NodeKind[];
  ruleKeys?: string[];
  kinds?: Array<'single_loop' | 'double_loop' | 'strategy'>;
  statuses?: DoubleLoopStatus[];
  excludeLegacy?: boolean;
  limit: number;
}

export interface RetrievedMemory extends MemorySlice {
  applicabilityScore: number;
  observedImpactScore: number;
  confidenceScore: number;
  recencyScore: number;
}

export interface AlgorithmAwareRetriever {
  retrieve(req: AlgorithmAwareRetrieveRequest): Promise<RetrievedMemory[]>;
}

export function createAlgorithmAwareRetriever(memoryStore: MemoryStore): AlgorithmAwareRetriever {
  return {
    async retrieve(req) {
      const tags = [
        ...req.algorithms,
        ...(req.phases ?? []),
        ...(req.nodeKinds ?? []),
        ...(req.ruleKeys ?? []),
      ];
      const entries = memoryStore.query({
        kind: 'lesson',
        tags: tags.length > 0 ? tags : undefined,
        limit: Math.max(req.limit * 3, req.limit),
      });
      return entries
        .map((entry) => {
          const applicabilityScore = scoreApplicability(entry.tags, tags);
          const observedImpactScore = clamp(entry.weight);
          const confidenceScore = entry.tags.includes('confidence:high') ? 1 : entry.tags.includes('confidence:medium') ? 0.66 : 0.33;
          const recencyScore = recency(entry.updated_at);
          return {
            id: entry.id,
            providerId: 'algorithm-aware-retriever',
            priority: applicabilityScore * 100 + observedImpactScore * 20 + confidenceScore * 10 + recencyScore,
            content: entry.text,
            sourceRefs: [entry.source],
            algorithm: req.algorithms[0],
            applicabilityScore,
            observedImpactScore,
            confidenceScore,
            recencyScore,
          };
        })
        .filter((item) => item.applicabilityScore > 0 || tags.length === 0)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, req.limit);
    },
  };
}

function scoreApplicability(entryTags: string[], requiredTags: string[]): number {
  if (requiredTags.length === 0) return 1;
  let hits = 0;
  for (const tag of requiredTags) {
    if (entryTags.includes(tag)) hits += 1;
  }
  return hits / requiredTags.length;
}

function recency(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const dayMs = 24 * 60 * 60 * 1000;
  return clamp(1 / (1 + ageMs / (30 * dayMs)));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

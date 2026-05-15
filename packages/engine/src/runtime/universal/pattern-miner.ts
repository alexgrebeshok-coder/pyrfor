import { createHash, randomUUID } from 'node:crypto';
import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { MemoryStore } from '../memory-store';
import type { TokenBudgetController } from '../token-budget-controller';
import type { ExperienceEntry, ExperienceLibrary } from './experience-library';
import type { ImprovementProposal } from './meta-critic';
import type { DoubleLoopRecord } from './memory/types';

export interface PatternMinerDeps {
  experienceLibrary: ExperienceLibrary;
  memoryStore: MemoryStore;
  artifactStore: ArtifactStore;
  budgetController?: TokenBudgetController;
  clock?: () => number;
}

export interface PatternMinerRunInput {
  runId: string;
  conceptId: string;
  conceptKind: 'meta.improvement';
  projectId: string;
  domain?: string;
  maxExperienceEntries?: number;
  maxProposals?: number;
  holdoutRatio?: number;
  minTrainingSupport?: number;
  minHoldoutSupport?: number;
  estimatedTokens?: number;
  estimatedCostUsd?: number;
}

export interface PatternMinerCandidate {
  patternKey: string;
  support: number;
  holdoutSupport: number;
  evidenceEntryIds: string[];
  holdoutEntryIds: string[];
  averageVerifierScore: number;
  averageAcceptancePassRate: number;
  toolSignatures: string[];
  domain?: string;
}

export interface PatternMinerRunResult {
  scanned: number;
  trainingCount: number;
  holdoutCount: number;
  candidates: PatternMinerCandidate[];
  candidateEntryIds: string[];
  proposalArtifactIds: string[];
  budgetBlocked: boolean;
}

export class PatternMinerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatternMinerValidationError';
  }
}

export function splitExperienceHoldout(
  entries: ExperienceEntry[],
  holdoutRatio = 0.2,
): { training: ExperienceEntry[]; holdout: ExperienceEntry[] } {
  const ratio = Math.min(Math.max(holdoutRatio, 0), 0.5);
  const sorted = [...entries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (sorted.length < 2 || ratio === 0) return { training: sorted, holdout: [] };
  const holdoutCount = Math.max(1, Math.ceil(sorted.length * ratio));
  return {
    training: sorted.slice(0, -holdoutCount),
    holdout: sorted.slice(-holdoutCount),
  };
}

export class PatternMiner {
  constructor(private readonly deps: PatternMinerDeps) {}

  async run(input: PatternMinerRunInput): Promise<PatternMinerRunResult> {
    validateInput(input);
    const budgetCheck = this.deps.budgetController?.canConsume({
      scope: 'self_improvement',
      targetId: input.runId,
      phaseId: 'pattern_mining',
      algorithm: 'system_self_improvement',
      toolName: 'pattern_miner',
      estPromptTokens: input.estimatedTokens ?? 0,
      estCompletionTokens: 0,
      estCostUsd: input.estimatedCostUsd ?? 0,
    });
    if (budgetCheck && !budgetCheck.allowed) {
      return emptyResult(true);
    }

    const entries = await this.deps.experienceLibrary.queryForPlanner({
      projectId: input.projectId,
      domain: input.domain,
      outcome: 'completed',
      limit: input.maxExperienceEntries ?? 200,
    });
    const { training, holdout } = splitExperienceHoldout(entries, input.holdoutRatio ?? 0.2);
    const candidates = mineSuccessPatterns(training, holdout, {
      minTrainingSupport: input.minTrainingSupport ?? 2,
      minHoldoutSupport: input.minHoldoutSupport ?? 1,
      maxProposals: input.maxProposals ?? 5,
    });
    const result: PatternMinerRunResult = {
      scanned: entries.length,
      trainingCount: training.length,
      holdoutCount: holdout.length,
      candidates,
      candidateEntryIds: [],
      proposalArtifactIds: [],
      budgetBlocked: false,
    };

    for (const candidate of candidates) {
      const written = await this.writeCandidate(input, candidate, training, holdout);
      if (!written) continue;
      result.candidateEntryIds.push(written.entryId);
      result.proposalArtifactIds.push(written.proposalRef.id);
    }
    if (this.deps.budgetController && ((input.estimatedTokens ?? 0) > 0 || (input.estimatedCostUsd ?? 0) > 0)) {
      this.deps.budgetController.recordConsumption({
        ts: this.nowMs(),
        scope: 'self_improvement',
        targetId: input.runId,
        phaseId: 'pattern_mining',
        algorithm: 'system_self_improvement',
        toolName: 'pattern_miner',
        promptTokens: input.estimatedTokens ?? 0,
        completionTokens: 0,
        costUsd: input.estimatedCostUsd ?? 0,
      });
    }
    return result;
  }

  private async writeCandidate(
    input: PatternMinerRunInput,
    candidate: PatternMinerCandidate,
    training: ExperienceEntry[],
    holdout: ExperienceEntry[],
  ): Promise<{ entryId: string; proposalRef: ArtifactRef } | undefined> {
    const similarityKey = `success-pattern:${input.projectId}:${stableSlug(candidate.patternKey)}`;
    if (this.hasExistingCandidate(similarityKey)) return undefined;
    const reportRef = await this.deps.artifactStore.writeJSON('summary', {
      schemaVersion: 'pyrfor.pattern_miner_report.v1',
      algorithm: 'success_extraction',
      projectId: input.projectId,
      domain: input.domain,
      candidate,
      trainingEntryIds: training.map((entry) => entry.id),
      holdoutEntryIds: holdout.map((entry) => entry.id),
      generatedAt: this.nowIso(),
    }, {
      runId: input.runId,
      meta: {
        conceptId: input.conceptId,
        patternKey: candidate.patternKey,
      },
    });
    const record = this.doubleLoopRecord(input, candidate, similarityKey, reportRef.id);
    const entry = this.deps.memoryStore.add({
      kind: 'lesson',
      text: JSON.stringify(record),
      source: `pattern-miner:${input.runId}`,
      scope: 'universal',
      tags: [
        'double_loop',
        'candidate',
        'self_improvement',
        'pattern_miner',
        'approvalState:pending_approval',
        'non_legacy',
        'non_quarantined',
        `project:${input.projectId}`,
        `ruleKey:${record.targetScope.ruleKey}`,
      ],
      weight: Math.min(1, 0.5 + candidate.averageVerifierScore / 2),
    });
    const proposal: ImprovementProposal = {
      schemaVersion: 'pyrfor.improvement_proposal.v1',
      entryId: entry.id,
      record,
      rollbackVerified: false,
      decision: 'pending',
      decisionReason: 'pattern_miner_candidate_requires_meta_critic',
      evaluatedAt: this.nowIso(),
    };
    const proposalRef = await this.deps.artifactStore.writeJSON('improvement_proposal', proposal, {
      runId: input.runId,
      meta: {
        conceptId: input.conceptId,
        entryId: entry.id,
        decision: proposal.decision,
        source: 'pattern_miner',
      },
    });
    return { entryId: entry.id, proposalRef };
  }

  private doubleLoopRecord(
    input: PatternMinerRunInput,
    candidate: PatternMinerCandidate,
    similarityKey: string,
    reportArtifactId: string,
  ): DoubleLoopRecord {
    const now = this.nowIso();
    const ruleKey = `system_self_improvement.success_pattern.${stableSlug(candidate.patternKey)}`;
    return {
      id: randomUUID(),
      kind: 'double_loop',
      provenance: 'native',
      confidence: candidate.holdoutSupport >= 2 ? 'high' : 'medium',
      context: {
        runId: input.runId,
        conceptId: input.conceptId,
        projectId: input.projectId,
        nodeId: 'pattern-miner',
        nodeHash: hashValue({ input, candidate }),
        algorithm: 'system_self_improvement',
        phase: 'self_improvement',
        nodeKind: 'consequential',
        domain: candidate.domain ?? input.domain,
        toolSignatures: candidate.toolSignatures,
        verifierScore: candidate.averageVerifierScore,
        acceptanceTestPassRate: candidate.averageAcceptancePassRate,
      },
      sourceLessonsArtifactRef: reportArtifactId,
      sourceRunId: input.runId,
      artifactIds: [reportArtifactId],
      approvalState: 'pending_approval',
      legacy: false,
      quarantined: false,
      evidence: [{ artifactRef: reportArtifactId, verifierConfirmed: true }],
      createdAt: now,
      author: 'agent:pattern_miner',
      proposedChangeType: 'heuristic',
      targetScope: {
        algorithm: 'strategic_planning',
        phase: 'plan',
        nodeKind: 'consequential',
        ruleKey,
        currentRule: 'No mined success-pattern heuristic is installed for this project scope.',
        proposedRule: `When project/domain context matches, inject the approved planning heuristic: ${candidate.patternKey}`,
      },
      systemicDefect: 'Repeated successful experience pattern is not yet represented as a reusable planning heuristic.',
      expectedImpact: `Increase planner reuse of a pattern seen ${candidate.support} times in training and ${candidate.holdoutSupport} times in holdout.`,
      impact: {
        predictedScore: candidate.averageVerifierScore,
        observedScore: candidate.averageVerifierScore,
        successRateDelta: candidate.holdoutSupport / Math.max(1, candidate.support + candidate.holdoutSupport),
        verifierPassRateDelta: candidate.averageAcceptancePassRate,
        riskDelta: 'same',
      },
      risks: ['pattern may be overfit to recent project-local successes'],
      rollbackPlan: `Reject or quarantine rule ${ruleKey}; planner falls back to approved MemoryStore retrieval without this heuristic.`,
      status: 'candidate',
      similarityKey,
      requiresNovelEvidenceAfterRejection: true,
    };
  }

  private hasExistingCandidate(similarityKey: string): boolean {
    return this.deps.memoryStore.query({ kind: 'lesson', tags: ['double_loop'], limit: 1_000 })
      .some((entry) => {
        let parsed: Partial<DoubleLoopRecord>;
        try {
          parsed = JSON.parse(entry.text) as Partial<DoubleLoopRecord>;
        } catch (error) {
          if (error instanceof SyntaxError) return false;
          throw error;
        }
        return parsed.similarityKey === similarityKey && parsed.status !== 'rejected' && parsed.status !== 'quarantined';
      });
  }

  private nowMs(): number {
    return (this.deps.clock ?? Date.now)();
  }

  private nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }
}

function mineSuccessPatterns(
  training: ExperienceEntry[],
  holdout: ExperienceEntry[],
  options: { minTrainingSupport: number; minHoldoutSupport: number; maxProposals: number },
): PatternMinerCandidate[] {
  const groups = new Map<string, { patternKey: string; training: ExperienceEntry[]; holdout: ExperienceEntry[] }>();
  for (const entry of training) {
    for (const patternKey of entry.reusablePatterns.map(normalizePattern).filter(Boolean)) {
      const group = groups.get(patternKey) ?? { patternKey, training: [], holdout: [] };
      group.training.push(entry);
      groups.set(patternKey, group);
    }
  }
  for (const entry of holdout) {
    for (const patternKey of entry.reusablePatterns.map(normalizePattern).filter(Boolean)) {
      const group = groups.get(patternKey);
      if (group) group.holdout.push(entry);
    }
  }
  return [...groups.values()]
    .filter((group) => group.training.length >= options.minTrainingSupport)
    .filter((group) => group.holdout.length >= options.minHoldoutSupport)
    .map((group) => toCandidate(group.patternKey, group.training, group.holdout))
    .sort((a, b) => (b.holdoutSupport + b.averageVerifierScore) - (a.holdoutSupport + a.averageVerifierScore))
    .slice(0, options.maxProposals);
}

function toCandidate(patternKey: string, training: ExperienceEntry[], holdout: ExperienceEntry[]): PatternMinerCandidate {
  const all = [...training, ...holdout];
  return {
    patternKey,
    support: training.length,
    holdoutSupport: holdout.length,
    evidenceEntryIds: training.map((entry) => entry.id),
    holdoutEntryIds: holdout.map((entry) => entry.id),
    averageVerifierScore: average(all.map((entry) => entry.verifierScore ?? entry.patternEffectiveness ?? 0.5)),
    averageAcceptancePassRate: average(all.map((entry) => entry.acceptanceTestPassRate ?? 0.5)),
    toolSignatures: uniqueStrings(all.flatMap((entry) => entry.retrievalKey.toolSignatures)),
    domain: all.find((entry) => entry.domain)?.domain,
  };
}

function validateInput(input: PatternMinerRunInput): void {
  if (!input.runId.trim()) throw new PatternMinerValidationError('runId is required');
  if (!input.conceptId.trim()) throw new PatternMinerValidationError('conceptId is required');
  if (input.conceptKind !== 'meta.improvement') {
    throw new PatternMinerValidationError('PatternMiner must run as a meta.improvement concept');
  }
  if (!input.projectId.trim() || input.projectId === '*') {
    throw new PatternMinerValidationError('projectId is required and cannot be wildcard');
  }
}

function normalizePattern(pattern: string): string {
  return pattern.trim().replace(/\s+/g, ' ');
}

function stableSlug(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function emptyResult(budgetBlocked: boolean): PatternMinerRunResult {
  return {
    scanned: 0,
    trainingCount: 0,
    holdoutCount: 0,
    candidates: [],
    candidateEntryIds: [],
    proposalArtifactIds: [],
    budgetBlocked,
  };
}

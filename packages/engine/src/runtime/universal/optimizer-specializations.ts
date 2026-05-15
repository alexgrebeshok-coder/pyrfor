import { createHash, randomUUID } from 'node:crypto';
import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { MemoryStore } from '../memory-store';
import type { ImprovementProposal } from './meta-critic';
import type { DoubleLoopRecord } from './memory/types';

export type OptimizerSpecialization =
  | 'prompt_engineer'
  | 'tool_smith'
  | 'skill_architect'
  | 'strategy_planner';

export type OptimizerAlgorithm =
  | 'failure_correction'
  | 'prompt_optimization';

export type NeverEditableByOptimizer =
  | 'verifier_rules'
  | 'sandbox_tier'
  | 'taint_scanners'
  | 'prompt_injection_gate'
  | 'kill_switch'
  | 'approval_thresholds'
  | 'budget_approval_rules'
  | 'effect_gateway_allowlists'
  | 'never_grandfathered_gate'
  | 'meta_critic_auto_apply_rules';

export const OPTIMIZER_SPECIALIZATIONS: readonly OptimizerSpecialization[] = [
  'prompt_engineer',
  'tool_smith',
  'skill_architect',
  'strategy_planner',
];

export const NEVER_EDITABLE_BY_OPTIMIZER: readonly NeverEditableByOptimizer[] = [
  'verifier_rules',
  'sandbox_tier',
  'taint_scanners',
  'prompt_injection_gate',
  'kill_switch',
  'approval_thresholds',
  'budget_approval_rules',
  'effect_gateway_allowlists',
  'never_grandfathered_gate',
  'meta_critic_auto_apply_rules',
];

export interface OptimizerProposalInput {
  runId: string;
  conceptId: string;
  conceptKind: 'meta.improvement';
  projectId: string;
  specialization: OptimizerSpecialization;
  algorithm: OptimizerAlgorithm;
  targetKey: string;
  currentBehavior: string;
  proposedBehavior: string;
  rationale: string;
  rollbackPlan: string;
  evidenceArtifactIds: string[];
  domain?: string;
  toolSignatures?: string[];
}

export interface OptimizerProposalResult {
  entryId: string;
  reportRef: ArtifactRef;
  proposalRef: ArtifactRef;
  record: DoubleLoopRecord;
}

export class OptimizerSpecializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimizerSpecializationError';
  }
}

export class OptimizerSpecializationRunner {
  constructor(private readonly deps: {
    memoryStore: MemoryStore;
    artifactStore: ArtifactStore;
    clock?: () => number;
  }) {}

  async propose(input: OptimizerProposalInput): Promise<OptimizerProposalResult> {
    validateOptimizerInput(input);
    const reportRef = await this.deps.artifactStore.writeJSON('summary', {
      schemaVersion: 'pyrfor.optimizer_specialization_report.v1',
      specialization: input.specialization,
      algorithm: input.algorithm,
      targetKey: input.targetKey,
      rationale: input.rationale,
      evidenceArtifactIds: input.evidenceArtifactIds,
      generatedAt: this.nowIso(),
    }, {
      runId: input.runId,
      meta: {
        conceptId: input.conceptId,
        specialization: input.specialization,
        algorithm: input.algorithm,
      },
    });
    const record = this.doubleLoopRecord(input, reportRef.id);
    const entry = this.deps.memoryStore.add({
      kind: 'lesson',
      text: JSON.stringify(record),
      source: `optimizer:${input.specialization}:${input.runId}`,
      scope: 'universal',
      tags: [
        'double_loop',
        'candidate',
        'self_improvement',
        'optimizer',
        `optimizer:${input.specialization}`,
        `optimizerAlgorithm:${input.algorithm}`,
        'approvalState:pending_approval',
        'non_legacy',
        'non_quarantined',
        `project:${input.projectId}`,
        `ruleKey:${record.targetScope.ruleKey}`,
      ],
      weight: 0.7,
    });
    const proposal: ImprovementProposal = {
      schemaVersion: 'pyrfor.improvement_proposal.v1',
      entryId: entry.id,
      record,
      rollbackVerified: false,
      decision: 'pending',
      decisionReason: 'optimizer_candidate_requires_meta_critic',
      evaluatedAt: this.nowIso(),
    };
    const proposalRef = await this.deps.artifactStore.writeJSON('improvement_proposal', proposal, {
      runId: input.runId,
      meta: {
        conceptId: input.conceptId,
        entryId: entry.id,
        specialization: input.specialization,
        decision: proposal.decision,
      },
    });
    return { entryId: entry.id, reportRef, proposalRef, record };
  }

  private doubleLoopRecord(input: OptimizerProposalInput, reportArtifactId: string): DoubleLoopRecord {
    const now = this.nowIso();
    return {
      id: randomUUID(),
      kind: 'double_loop',
      provenance: 'native',
      confidence: 'medium',
      context: {
        runId: input.runId,
        conceptId: input.conceptId,
        projectId: input.projectId,
        nodeId: `optimizer:${input.specialization}`,
        nodeHash: hashValue(input),
        algorithm: 'system_self_improvement',
        phase: 'self_improvement',
        nodeKind: 'consequential',
        ...(input.domain ? { domain: input.domain } : {}),
        ...(input.toolSignatures ? { toolSignatures: input.toolSignatures } : {}),
      },
      sourceLessonsArtifactRef: reportArtifactId,
      sourceRunId: input.runId,
      artifactIds: [reportArtifactId, ...input.evidenceArtifactIds],
      approvalState: 'pending_approval',
      legacy: false,
      quarantined: false,
      evidence: [
        { artifactRef: reportArtifactId, verifierConfirmed: false },
        ...input.evidenceArtifactIds.map((artifactRef) => ({ artifactRef, verifierConfirmed: true })),
      ],
      createdAt: now,
      author: `agent:${input.specialization}`,
      proposedChangeType: input.algorithm === 'prompt_optimization' ? 'heuristic' : 'algorithm',
      targetScope: {
        algorithm: input.specialization === 'strategy_planner' ? 'strategic_planning' : 'system_self_improvement',
        phase: 'self_improvement',
        nodeKind: 'consequential',
        ruleKey: optimizerRuleKey(input),
        currentRule: input.currentBehavior,
        proposedRule: input.proposedBehavior,
      },
      systemicDefect: input.rationale,
      expectedImpact: `Improve ${input.specialization} via ${input.algorithm} without editing protected governance surfaces.`,
      impact: {
        predictedScore: 0.5,
        riskDelta: 'same',
      },
      risks: ['optimizer proposal may be overfit and must pass MetaCritic eval before activation'],
      rollbackPlan: input.rollbackPlan,
      status: 'candidate',
      similarityKey: optimizerSimilarityKey(input),
      requiresNovelEvidenceAfterRejection: true,
    };
  }

  private nowIso(): string {
    return new Date((this.deps.clock ?? Date.now)()).toISOString();
  }
}

export function assertOptimizerTargetEditable(targetKey: string): void {
  const normalized = normalizeTarget(targetKey);
  for (const forbidden of NEVER_EDITABLE_BY_OPTIMIZER) {
    if (normalized.includes(forbidden)) {
      throw new OptimizerSpecializationError(`optimizer cannot edit protected target: ${forbidden}`);
    }
  }
  const aliases: Array<[NeverEditableByOptimizer, string[]]> = [
    ['verifier_rules', ['verifier-rule', 'verifier.rules', 'quality-gate']],
    ['sandbox_tier', ['sandbox-tier', 'sandbox.tier']],
    ['taint_scanners', ['taint-scan', 'taint.scan']],
    ['prompt_injection_gate', ['prompt-injection', 'injection-gate']],
    ['kill_switch', ['killswitch', 'kill-switch']],
    ['approval_thresholds', ['approval-flow', 'approval.threshold']],
    ['budget_approval_rules', ['budget-policy', 'budget.approval']],
    ['effect_gateway_allowlists', ['effect-gateway.allowlist', 'egress-allowlist']],
    ['never_grandfathered_gate', ['never-grandfathered', 'grandfathered-gate']],
    ['meta_critic_auto_apply_rules', ['auto-apply', 'meta-critic.auto']],
  ];
  const match = aliases.find(([, values]) => values.some((value) => normalized.includes(value)));
  if (match) throw new OptimizerSpecializationError(`optimizer cannot edit protected target: ${match[0]}`);
}

function validateOptimizerInput(input: OptimizerProposalInput): void {
  if (!input.runId.trim()) throw new OptimizerSpecializationError('runId is required');
  if (!input.conceptId.trim()) throw new OptimizerSpecializationError('conceptId is required');
  if (input.conceptKind !== 'meta.improvement') {
    throw new OptimizerSpecializationError('optimizer specialization must run as a meta.improvement concept');
  }
  if (!input.projectId.trim() || input.projectId === '*') {
    throw new OptimizerSpecializationError('projectId is required and cannot be wildcard');
  }
  if (!OPTIMIZER_SPECIALIZATIONS.includes(input.specialization)) {
    throw new OptimizerSpecializationError(`unsupported optimizer specialization: ${input.specialization}`);
  }
  if (input.algorithm !== 'failure_correction' && input.algorithm !== 'prompt_optimization') {
    throw new OptimizerSpecializationError(`unsupported optimizer algorithm: ${input.algorithm}`);
  }
  if (!input.targetKey.trim()) throw new OptimizerSpecializationError('targetKey is required');
  assertOptimizerTargetEditable(input.targetKey);
  if (!input.currentBehavior.trim()) throw new OptimizerSpecializationError('currentBehavior is required');
  if (!input.proposedBehavior.trim()) throw new OptimizerSpecializationError('proposedBehavior is required');
  if (!input.rollbackPlan.trim()) throw new OptimizerSpecializationError('rollbackPlan is required');
  if (input.evidenceArtifactIds.length === 0) throw new OptimizerSpecializationError('evidenceArtifactIds are required');
}

function optimizerRuleKey(input: OptimizerProposalInput): string {
  return `system_self_improvement.optimizer.${input.specialization}.${stableSlug(input.targetKey)}`;
}

function optimizerSimilarityKey(input: OptimizerProposalInput): string {
  return `optimizer:${input.projectId}:${input.specialization}:${input.algorithm}:${stableSlug(input.targetKey)}`;
}

function stableSlug(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeTarget(value: string): string {
  return value.trim().toLowerCase().replace(/[\s/]+/g, '_');
}

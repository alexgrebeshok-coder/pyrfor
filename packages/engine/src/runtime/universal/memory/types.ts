import type { MemoryEntry } from '../../memory-store';
import type { GovernedAlgorithm } from '../completion-gate-engine';
import type { DecisionRecord, LessonDecisionImpact } from '../decision-record-auditor';

export type NodeKind = 'consequential' | 'autonomous' | 'toolforge' | 'verification' | 'legacy';
export type LessonProvenance = 'native' | 'legacy' | 'imported';
export type DoubleLoopStatus = 'candidate' | 'pending_approval' | 'approved' | 'rejected' | 'quarantined' | 'superseded';

export type LessonRootCause =
  | 'spec_gap'
  | 'tool_gap'
  | 'execution_bug'
  | 'test_gap'
  | 'verifier_disagreement'
  | 'budget_or_tier'
  | 'external_dependency';

export interface LessonContext {
  runId: string;
  conceptId?: string;
  nodeId: string;
  nodeHash: string;
  algorithm: GovernedAlgorithm;
  phase: string;
  nodeKind: NodeKind;
  toolName?: string;
  toolVersion?: string;
}

export interface LessonEvidenceRef {
  artifactRef: string;
  verifierConfirmed: boolean;
  verifierRefs?: string[];
}

export interface LessonImpactVector {
  predictedScore?: number;
  observedScore?: number;
  costDeltaUsd?: number;
  latencyDeltaMs?: number;
  successRateDelta?: number;
  verifierPassRateDelta?: number;
  riskDelta?: 'lower' | 'same' | 'higher';
}

export interface BaseLessonRecord {
  id: string;
  kind: 'single_loop' | 'double_loop';
  provenance: LessonProvenance;
  confidence: 'low' | 'medium' | 'high';
  context: LessonContext;
  sourceLessonsArtifactRef: string;
  evidence: LessonEvidenceRef[];
  createdAt: string;
  author: 'historian' | 'meta_critic' | `agent:${string}`;
  originDecisionRecordRef?: string;
  supportingDecisionRecordRefs?: string[];
}

export interface SingleLoopRecord extends BaseLessonRecord {
  kind: 'single_loop';
  defectRootCause: LessonRootCause;
  defectSignature: string;
  fixApplied: string;
  fixType: 'replan' | 'refactor' | 'tool_retry' | 'tool_swap' | 'test_rewrite' | 'spec_clarification';
  algorithmOutcome: 'improved' | 'neutral' | 'worsened';
  reusablePattern?: string;
  localOnly: boolean;
  eligibleForStrategyDistillation: boolean;
}

export interface DoubleLoopRecord extends BaseLessonRecord {
  kind: 'double_loop';
  proposedChangeType: 'algorithm' | 'heuristic' | 'policy' | 'budget' | 'verifier_rules';
  targetScope: {
    algorithm?: GovernedAlgorithm;
    phase?: string;
    nodeKind?: NodeKind;
    ruleKey: string;
    currentRule: string;
    proposedRule: string;
  };
  systemicDefect: string;
  expectedImpact: string;
  impact: LessonImpactVector;
  risks: string[];
  rollbackPlan: string;
  approvalFlowRef?: string;
  status: DoubleLoopStatus;
  rejectionReason?: string;
  supersedesRecordId?: string;
  similarityKey: string;
  requiresNovelEvidenceAfterRejection: boolean;
}

export interface LessonsQuery {
  kinds?: Array<'single_loop' | 'double_loop'>;
  statuses?: DoubleLoopStatus[];
  algorithms?: GovernedAlgorithm[];
  phases?: string[];
  nodeKinds?: NodeKind[];
  rootCauses?: LessonRootCause[];
  proposedChangeTypes?: DoubleLoopRecord['proposedChangeType'][];
  provenance?: LessonProvenance[];
  ruleKeys?: string[];
  minConfidence?: 'low' | 'medium' | 'high';
  minObservedImpactScore?: number;
  newerThan?: string;
  limit: number;
  rankBy?: Array<'applicability' | 'observed_impact' | 'confidence' | 'recency'>;
  includeRejectedForAntiThrash?: boolean;
}

export interface StrategyAlgorithmContext {
  algorithm: GovernedAlgorithm;
  workedBecause?: string;
  failedBecause?: string;
  evidenceRefs: string[];
}

export interface StrategyEntry {
  memoryEntryId: string;
  key: string;
  value: string;
  domain?: string;
  projectId?: string;
  rationale?: string;
  source: 'user' | 'historian-distilled';
  sourceArtifactRef?: string;
  impactScore: number;
  governedByAlgorithm?: GovernedAlgorithm;
  decisionRecordRef?: string;
  algorithmContext?: StrategyAlgorithmContext;
  approval: 'approved';
  createdAt: string;
  updatedAt: string;
}

export interface StrategySetInput {
  key: string;
  value: string;
  domain?: string;
  projectId?: string;
  rationale?: string;
  source: StrategyEntry['source'];
  sourceArtifactRef?: string;
  impactScore?: number;
  governedByAlgorithm?: GovernedAlgorithm;
  decisionRecordRef?: string;
  algorithmContext?: StrategyAlgorithmContext;
}

export interface StrategyListQuery {
  projectId?: string;
  domain?: string;
  limit?: number;
  includeGlobal?: boolean;
}

export interface MemorySlice {
  id: string;
  providerId: string;
  priority: number;
  content: unknown;
  sourceRefs: string[];
  algorithm?: GovernedAlgorithm;
}

export interface MemoryPrefetchRequest {
  runId: string;
  projectId?: string;
  decisionRecordId?: string;
  algorithm?: GovernedAlgorithm;
  phase?: string;
  nodeKind?: NodeKind;
  ruleKeys?: string[];
  domain?: string;
  limit: number;
}

export interface MemoryPrefetchResult {
  slices: MemorySlice[];
  entries?: MemoryEntry[];
  lessonsConsidered?: LessonDecisionImpact[];
}

export interface MemoryTurnSync {
  runId: string;
  turnId: string;
  content: string;
  decisionRecord?: DecisionRecord;
}

export interface MemoryWriteResult {
  wrote: number;
  skipped: number;
  lessonsDetected?: Array<SingleLoopRecord | DoubleLoopRecord>;
}

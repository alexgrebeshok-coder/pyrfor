import type { AIActionType, AICompensationMode, AIProposalSafetyProfile } from '../ai/types';
import type {
  EscalationQueueStatus,
  EscalationUrgency,
} from '../escalations/types';

export type KnowledgePlaybookMaturity = "emerging" | "repeated";

export interface KnowledgeBenchmarkView {
  ownerRole: string | null;
  ackTargetHours: number;
  resolutionRate: number;
  breachRate: number;
  source: "observed_history" | "sla_window";
}

export interface KnowledgePlaybookView {
  id: string;
  title: string;
  patternKey: string;
  proposalType: AIActionType | null;
  purpose: string | null;
  maturity: KnowledgePlaybookMaturity;
  totalOccurrences: number;
  openOccurrences: number;
  resolvedOccurrences: number;
  benchmark: KnowledgeBenchmarkView;
  mutationSurface: AIProposalSafetyProfile["mutationSurface"] | string;
  compensationMode: AICompensationMode | "follow_up_patch";
  guidance: string;
  lessons: string[];
}

export interface KnowledgeGuidanceView {
  escalationId: string;
  projectName: string | null;
  title: string;
  urgency: EscalationUrgency;
  queueStatus: EscalationQueueStatus;
  playbookId: string;
  playbookTitle: string;
  benchmarkSummary: string;
  recommendedAction: string;
}

export interface KnowledgeLoopSummary {
  totalPlaybooks: number;
  repeatedPlaybooks: number;
  benchmarkedGuidance: number;
  trackedPatterns: number;
}

export interface KnowledgeLoopOverview {
  generatedAt: string;
  summary: KnowledgeLoopSummary;
  playbooks: KnowledgePlaybookView[];
  activeGuidance: KnowledgeGuidanceView[];
}

export interface KnowledgeLoopQuery {
  limit?: number;
  projectId?: string;
}

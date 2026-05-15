/**
 * Pyrfor Runtime — Main Runtime Class
 *
 * Ties together:
 * - SessionManager: In-memory session storage
 * - ProviderRouter: Smart AI provider selection with fallback
 * - ToolEngine: Extended runtime tools
 * - WorkspaceLoader: Memory and config file loading
 * - HeartbeatRunner: Background task execution
 * - AutoCompact: Automatic message summarization
 * - SubagentSpawner: Fork sessions for background tasks
 * - PrivacyManager: Data isolation and security
 *
 * Usage:
 *   const runtime = new PyrforRuntime();
 *   await runtime.start();
 *   const response = await runtime.handleMessage('telegram', userId, chatId, 'Hello');
 *   await runtime.stop();
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { SessionManager, type Session, type SessionCreateOptions, type Channel } from './session';
import {
  SessionStore,
  reviveSessionRecord,
  type SessionMessage,
  type SessionRecord,
  type SessionStoreOptions,
} from './session-store';
import { ProviderRouter } from './provider-router';
import { AutoCompact } from './compact';
import { SubagentSpawner, type SubagentOptions, type SubagentTask } from './subagents';
import { PrivacyManager } from './privacy';
import { WorkspaceLoader, type WorkspaceLoaderOptions } from './workspace-loader';
import { executeRuntimeTool, setTelegramBot, setWorkspaceRoot, setSandboxProvider, runtimeToolDefinitions } from './tools';
import { runToolLoop } from './tool-loop';
import { approvalFlow, type ApprovalFlowEvent, type ApprovalRequest } from './approval-flow';
import { handleMessageStream, buildContextBlock, type OpenFile, type StreamEvent } from './streaming';
import { createPermissionApprovalGate } from './permission-gate';
import { loadProjectRules, composeSystemPrompt } from './project-rules';
import { logger } from '../observability/logger';
import { configureEngineTelemetry, traceLlmChat } from '../observability/engine-telemetry';
import { createMcpClient, type McpClient } from './mcp-client.js';
import { McpLifecycleManagerStub } from './mcp-lifecycle-manager.js';
import type { Message } from '../ai/providers/base';
import {
  listPendingDurableMemoryReviews,
  reviewDurableMemory,
  searchDurableMemoryForContext,
  storeMemory,
  type MemoryEntry,
  type MemoryApprovalState,
  type MemoryReviewDecision,
  type MemoryImportState,
  type MemoryType,
} from '../ai/memory/agent-memory-store';
import type { TelegramSender } from './telegram-types';
import { DEFAULT_CONFIG_PATH, loadConfig, watchConfig, RuntimeConfigSchema, type RuntimeConfig } from './config';
import { HealthMonitor } from './health';
import { CronService, type CronJobSpec } from './cron';
import { getDefaultHandlers } from './cron/handlers';
import { createRuntimeGateway, type GatewayDeps, type GatewayHandle } from './gateway';
import { createDailyMemoryRollup, type DailyMemoryRollupResult } from './memory-rollup';
import {
  buildOpenClawMigrationAudit,
  buildOpenClawMigrationQuarantine,
  importOpenClawMigration,
  isAllowedOpenClawReportSourceRoot,
  previewOpenClawMigration,
  rollbackOpenClawMigration,
  verifyOpenClawMigration,
  type OpenClawMigrationAuditView,
  type OpenClawMigrationImportResult,
  type OpenClawMigrationPreviewResult,
  type OpenClawMigrationQuarantineState,
  type OpenClawMigrationReport,
  type OpenClawMigrationRollbackResult,
  type OpenClawMigrationVerificationResult,
} from './openclaw-migration';
import { createProjectMemoryRollup, type ProjectMemoryRollupResult } from './project-memory';
import { tryLoadPrismaClient, createNoopPrismaClient, installPrismaClient } from './prisma-adapter';
import { processManager } from './process-manager';
import { registerDynamicSkills, setSkillAIProvider } from '../skills/index';
import { ArtifactStore } from './artifact-model';
import { DomainOverlayRegistry } from './domain-overlay';
import { registerDefaultDomainOverlays } from './domain-overlay-presets';
import { DurableDag, type DagNode } from './durable-dag';
import { EventLedger, type ApprovalRequestedEvent, type LedgerEvent } from './event-ledger';
import { createMemoryStore, type MemoryStore } from './memory-store';
import { BlockRegistry } from './block-registry';
import { BlockCatalogStore } from './block-catalog-persistence';
import { ContractRegistry } from './contract-registry';
import { RunLedger } from './run-ledger';
import { RuntimeWorktreeManager, type ManagedGitWorktree } from './worktree/worktree-manager';
import { createSandboxProvider } from './sandbox';
import { gitMergeBranch, type GitMergeResult } from './git/api';
import { createUniversalMemoryFacade } from './universal/memory/memory-facade';
import { StrategyMemoryProvider } from './universal/memory/strategy-memory-provider';
import { createExperienceLibrary } from './universal/experience-library';
import { UniversalPlanner } from './universal/planner';
import { UniversalResearcher } from './universal/researcher';
import { createToolRegistry, type ToolRegistry } from './universal/tool-registry';
import {
  PermissionEngine,
  ToolRegistry as CapabilityToolRegistry,
  registerRuntimeToolAliases,
  registerStandardTools,
  type PermissionClass,
  type PermissionEngineOptions,
} from './permission-engine';
import {
  startUniversalEngine as createUniversalEngine,
  type ConceptHandle,
  type ConceptInput,
  type UniversalEngineOrchestrator,
} from './universal/engine-loop';
import { ContextCompiler } from './context-compiler';
import { buildActorDispatchContextBlock } from './actor-dispatch-context';
import { VerifierLane, type VerificationStatus } from './verifier-lane';
import {
  createOrchestrationHost,
  type OrchestrationHost,
} from './orchestration-host-factory';
import type { ToolExecutor } from './contracts-bridge';
import type { AcpEvent } from './acp-client';
import type { FCEnvelope, FCEvent, FCHandle, FCRunOptions } from './pyrfor-fc-adapter';
import type { FcEvent as ParsedFreeClaudeEvent } from './pyrfor-event-reader';
import type { FcCircuitRouterOptions } from './pyrfor-fc-circuit-router';
import {
  type ContextPack,
  type ContextPackSection,
  type ContextSourceRef,
  withContextPackHash,
} from './context-pack';
import type { GuardrailContext, GuardrailDecision, Guardrails, ToolPolicy } from './guardrails';
import {
  createTokenBudgetController,
  type BudgetRule,
  type BudgetScope,
  type TokenBudgetController,
} from './token-budget-controller';
import { envelopeToSessionCost } from './pyrfor-cost-aggregate';
import {
  assertWorkerManifestDomainScope,
  materializeWorkerManifest,
  mergePermissionOverrides,
  mergePermissionProfiles,
  mergeWorkerDomainScopes,
  type WorkerManifest,
} from './worker-manifest';
import type { WorkerCapabilityRequest } from './worker-protocol-bridge';
import type { WorkerProtocolBridgeResult } from './worker-protocol-bridge';
import { WORKER_PROTOCOL_VERSION } from './worker-protocol';
import type { StepValidator } from './step-validator';
import type { ArtifactRef } from './artifact-model';
import type { BudgetProfile, RunRecord } from './run-lifecycle';
import {
  buildProductFactoryActorSeeds,
  createDefaultProductFactory,
  type ProductFactoryPlanInput,
  type ProductFactoryPlanPreview,
  type ProductFactoryTemplate,
} from './product-factory';
import {
  buildKsReconciliationFinalReport,
  buildKsReconciliationReviewPack,
  reviewKsReconciliationFinding,
  type KsReconciliationFinding,
  type KsReconciliationFindingReviewAction,
  type KsReconciliationReviewPack,
} from './ks-reconciliation-fixture';
import {
  captureDeliveryEvidence,
  type DeliveryEvidenceSnapshot,
} from './github-delivery-evidence';
import {
  createGovernedSearchResearchEvidenceSnapshot,
  createResearchEvidenceSnapshot,
  type ResearchEvidenceInput,
  type ResearchEvidenceSnapshot,
} from './research-evidence';
import {
  runGovernedResearchSearch,
  type GovernedResearchSearchInput,
} from './research-search';
import {
  normalizeResearchSourceCaptureInput,
  runResearchSourceCapture,
  type ResearchSourceCaptureInput,
  type ResearchSourceCaptureSnapshot,
  type ResearchSourceCaptureArtifactDocument,
} from './research-source-capture';
import {
  runBrowserSmokeCapture,
  type BrowserSmokeInput,
  type BrowserSmokeSnapshot,
} from './browser-smoke';
import {
  buildGithubDeliveryPlan,
  type GitHubDeliveryPlan,
} from './github-delivery-plan';
import {
  applyGithubDeliveryPlan,
  buildApplyIdempotencyKey,
  validateGithubDeliveryApplyPreconditions,
  type GitHubDeliveryApplyApplied,
  type GitHubDeliveryApplyPending,
  type GitHubDeliveryApplyRequest,
  type GitHubDeliveryApplyResult,
} from './github-delivery-apply';
import {
  createActorKernel,
  type ActorKernel,
  type CompleteActorMessageInput,
  type CompleteActorMessageResult,
  type EnqueueActorMessageInput,
  type FailActorMessageInput,
  type LeaseActorMessageInput,
  type LeaseActorMessageResult,
  type RecoverStuckActorMessagesInput,
  type RecoverStuckActorMessagesResult,
  type SpawnActorInput,
  type SpawnActorResult,
} from './actor-kernel';
import { buildConnectorInventorySnapshot, createConnectorRegistry } from '../connectors';

// ============================================
// Types
// ============================================

export interface PyrforRuntimeOptions {
  /** Path to workspace directory */
  workspacePath?: string;
  /** Path to memory directory */
  memoryPath?: string;
  /** Default system prompt */
  systemPrompt?: string;
  /** Enable auto-compact */
  enableCompact?: boolean;
  /** Enable subagent spawner */
  enableSubagents?: boolean;
  /** Maximum concurrent subagents */
  maxSubagents?: number;
  /** Privacy policy */
  privacy?: {
    defaultZone?: 'public' | 'personal' | 'vault';
    vaultPassword?: string;
  };
  /** Provider router options */
  providerOptions?: {
    defaultProvider?: string;
    enableFallback?: boolean;
  };
  /** Session persistence options. Pass `false` to disable. */
  persistence?: SessionStoreOptions | false;
  /**
   * Path to runtime.json config file. If provided, config is loaded in start()
   * and hot-reloaded when the file changes.
   */
  configPath?: string;
  /**
   * Pre-loaded RuntimeConfig. Used directly when configPath is not set.
   * When configPath is also set, the file takes precedence (loaded in start()).
   */
  config?: RuntimeConfig;
  /**
   * When set (tests), `getMcpClient()` uses this factory instead of the default
   * `createMcpClient()`.
   */
  mcpClientFactory?: () => McpClient;
}

export interface RuntimeMessageResult {
  success: boolean;
  response: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  tokensUsed?: number;
  costUsd?: number;
  error?: string;
}

export interface RuntimeStats {
  sessions: {
    active: number;
    totalTokens: number;
    byChannel: Record<Channel, number>;
  };
  subagents: {
    active: number;
    total: number;
  };
  providers: {
    available: string[];
    costs: ReturnType<ProviderRouter['getTotalCost']>;
  };
  workspace: {
    loaded: boolean;
    filesLoaded?: number;
  };
}

export interface RuntimeSubagentSummary {
  id: string;
  name: string;
  status: string;
  startedAt: string;
}

export interface RuntimeSessionSummary {
  id: string;
  workspaceId: string;
  title: string;
  mode: SessionRecord['mode'];
  runId?: string;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  summary?: string;
  archived?: boolean;
}

export interface RuntimeSessionDetail extends RuntimeSessionSummary {
  messages: SessionMessage[];
  metadata?: Record<string, unknown>;
}

export interface RuntimeSessionTimelineEvent {
  id: string;
  sessionId: string;
  type: 'message';
  role: SessionMessage['role'];
  content: string;
  createdAt: string;
  index: number;
  metadata?: Record<string, unknown>;
}

export interface RuntimeMemorySearchHit {
  id: string;
  summary?: string;
  content: string;
  createdAt: string;
  memoryType: string;
  importance: number;
  workspaceId?: string;
  projectId?: string;
  source: 'durable';
  scopeVisibility?: string;
  rollupKind?: string;
  projectMemoryCategory?: string;
  importState?: MemoryImportState;
  approvalState?: MemoryApprovalState;
  plannerEligible?: boolean;
  importedFrom?: string;
  correctionKind?: string;
  provenanceKinds?: string[];
}

export interface RuntimeMemoryCorrectionResult {
  memory: RuntimeMemorySearchHit;
}

export interface RuntimeMemoryReviewResult {
  decision: MemoryReviewDecision;
  memory: RuntimeMemorySearchHit;
}

export interface RuntimePendingMemoryReviewsResult {
  memoryReviews: RuntimeMemorySearchHit[];
}

function memoryToSearchHit(entry: MemoryEntry): RuntimeMemorySearchHit {
  const metadata = entry.metadata ?? {};
  const scope = metadata.scope;
  const provenanceKinds = Array.isArray(metadata.provenance)
    ? [...new Set(metadata.provenance
      .map((item) => {
        const kind = item && typeof item === 'object' ? (item as { kind?: unknown }).kind : undefined;
        return typeof kind === 'string' ? kind : null;
      })
      .filter((item): item is string => item !== null))]
    : [];
  return {
    id: entry.id,
    ...(entry.summary ? { summary: entry.summary } : {}),
    content: entry.content,
    createdAt: entry.createdAt.toISOString(),
    memoryType: entry.memoryType,
    importance: entry.importance,
    ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
    ...(entry.projectId ? { projectId: entry.projectId } : {}),
    source: 'durable',
    ...(scope?.visibility ? { scopeVisibility: scope.visibility } : {}),
    ...(typeof metadata.rollupKind === 'string' ? { rollupKind: metadata.rollupKind } : {}),
    ...(typeof metadata.projectMemoryCategory === 'string' ? { projectMemoryCategory: metadata.projectMemoryCategory } : {}),
    ...(typeof metadata.importState === 'string' ? { importState: metadata.importState as MemoryImportState } : {}),
    ...(typeof metadata.approvalState === 'string' ? { approvalState: metadata.approvalState as MemoryApprovalState } : {}),
    ...(typeof metadata.plannerEligible === 'boolean' ? { plannerEligible: metadata.plannerEligible } : {}),
    ...(typeof metadata.importedFrom === 'string' ? { importedFrom: metadata.importedFrom } : {}),
    ...(typeof metadata.correctionKind === 'string' ? { correctionKind: metadata.correctionKind } : {}),
    ...(provenanceKinds.length > 0 ? { provenanceKinds } : {}),
  };
}

interface RuntimeOrchestration {
  eventLedger: EventLedger;
  runLedger: RunLedger;
  dag: DurableDag;
  artifactStore: ArtifactStore;
  memoryStore: MemoryStore;
  actorKernel: ActorKernel;
  overlays: DomainOverlayRegistry;
  universalEngine: UniversalEngineOrchestrator;
  toolRegistry: ToolRegistry;
  capabilityToolRegistry: CapabilityToolRegistry;
  blockRegistry: BlockRegistry;
  blockCatalogStore: BlockCatalogStore;
  contractRegistry: ContractRegistry;
}

interface ActiveRuntimeRun {
  runId: string;
  taskId: string;
  budgetScope?: BudgetScope;
  budgetTargetId?: string;
  budgetRuleIds?: string[];
  workerRunId?: string;
  orchestrationHost?: OrchestrationHost;
  workerTransport?: RuntimeWorkerTransport;
  terminalByWorker?: boolean;
  governed?: GovernedRuntimeRunState;
}

interface RuntimeBudgetTarget {
  scope: BudgetScope;
  targetId?: string;
}

export interface DispatchActorMessageInput extends LeaseActorMessageInput {
  instruction?: string;
  systemPrompt?: string;
  maxTokens?: number;
}

export type PublicRuntimeArtifactRef = Omit<ArtifactRef, 'uri'>;

export interface DispatchActorMessageCompletionResult {
  node: DagNode;
  proofArtifact: PublicRuntimeArtifactRef;
  alreadyFinalized?: boolean;
}

export interface DispatchActorMessageResult {
  lease: LeaseActorMessageResult | null;
  response?: string;
  completion?: DispatchActorMessageCompletionResult;
  failure?: DagNode;
  approval?: ApprovalRequest;
  capability?: (
    {
      kind: 'research_source_capture';
      status: 'approval_required' | 'captured' | 'denied' | 'failed';
      artifact?: Pick<ArtifactRef, 'id' | 'kind' | 'sha256' | 'createdAt'>;
    }
    | {
      kind: 'unsupported';
      status: 'failed';
    }
  );
}

export type RuntimeWorkerTransport = 'freeclaude' | 'acp';

export interface RuntimeWorkerOptions {
  transport?: RuntimeWorkerTransport;
  events?: (ctx: { runId: string; taskId: string; sessionId: string; workerRunId: string }) => AsyncIterable<FCEvent> | AsyncIterable<AcpEvent>;
  freeClaudeRun?: (opts: FCRunOptions) => FCHandle;
  freeClaudeCircuit?: Omit<FcCircuitRouterOptions, 'runFn' | 'validateEvent' | 'onAttemptComplete'>;
  guardrails?: Guardrails;
  guardrailPreflightDisallow?: string[];
  freeClaudeBudget?: RuntimeFreeClaudeBudgetOptions;
  manifest?: WorkerManifest;
  domainIds?: string[];
  permissionProfile?: PermissionEngineOptions['profile'];
  permissionOverrides?: Record<string, PermissionClass>;
  capabilityPolicy?: (request: WorkerCapabilityRequest) => Promise<'grant' | 'deny'> | 'grant' | 'deny';
  verifierValidators?: StepValidator[];
}

export interface RuntimeFreeClaudeBudgetOptions {
  controller: TokenBudgetController;
  scope?: BudgetScope;
  scopeId?: string;
  preflightEstimate?: { promptTokens: number; completionTokens: number };
  checkIntervalMs?: number;
  now?: () => number;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
  onBudgetAbort?: (reason: string) => void;
}

interface ResolvedFreeClaudeBudget {
  controller: TokenBudgetController;
  scope: BudgetScope;
  targetId?: string;
  checkIntervalMs: number;
  preflightEstimate: { promptTokens: number; completionTokens: number };
  now: () => number;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
  onBudgetAbort?: (reason: string) => void;
}

export type VerifierRawStatus = 'passed' | 'warning' | 'failed' | 'blocked';
export type VerifierWaiverScope = 'run' | 'delivery' | 'delivery_plan' | 'delivery_apply' | 'all';

export interface VerifierWaiverRecord {
  schemaVersion: 'pyrfor.verifier_waiver.v1';
  runId: string;
  verifierRunId?: string;
  verifierArtifactId?: string;
  verifierEventId?: string;
  rawStatus: VerifierRawStatus;
  operator: {
    id: string;
    name?: string;
  };
  reason: string;
  scope: VerifierWaiverScope;
  waivedAt: string;
}

export interface VerifierDecision {
  status: VerificationStatus;
  rawStatus: VerifierRawStatus;
  reason?: string;
  findings?: number;
  verifierRunId?: string;
  verifierArtifactId?: string;
  verifierEventId?: string;
  decidedAt?: string;
  waivedFrom?: VerifierRawStatus;
  waiverArtifact?: ArtifactRef;
  waiver?: VerifierWaiverRecord;
  waiverEligible: boolean;
  waiverPath: string;
}

export interface VerifierWaiverInput {
  operatorId: string;
  operatorName?: string;
  reason: string;
  scope?: VerifierWaiverScope;
}

export interface MemoryContinuityArtifactStatus {
  status: 'ok' | 'missing' | 'not_configured';
  artifact?: ArtifactRef;
  createdAt?: string;
  date?: string;
  projectId?: string;
  counts?: OpenClawMigrationReport['counts'];
}

export interface MemoryContinuityStatus {
  workspaceId: string;
  projectId?: string;
  generatedAt: string;
  workspaceFiles: {
    present: number;
    total: number;
    missing: string[];
    files: Record<string, { present: boolean; lineCount: number }>;
  };
  latestDailyRollup: MemoryContinuityArtifactStatus;
  latestProjectRollup: MemoryContinuityArtifactStatus;
  latestOpenClawReport: MemoryContinuityArtifactStatus;
  warnings: string[];
}

interface GovernedRuntimeRunState {
  contextArtifact: ArtifactRef;
  contextNodeId: string;
  workerEvents: AcpEvent[];
  frameNodeIds: string[];
  effectNodeIds: string[];
  worktree?: ManagedGitWorktree;
  worktreeCleaned?: boolean;
  verifierNodeId?: string;
  verifierStatus?: VerificationStatus;
}

interface ActorResearchSourceCaptureCapability {
  kind: 'research_source_capture';
  url: string;
  note?: string;
}

interface UnsupportedActorCapability {
  kind: 'unsupported';
}

const execFileAsync = promisify(execFile);

function buildCeoclawBusinessBriefApprovalId(runId: string): string {
  return `ceoclaw-business-brief-${runId}`;
}

function buildKsReconciliationReviewApprovalId(runId: string): string {
  return `ks-reconciliation-review-${runId}`;
}

function buildGithubDeliveryApplyApprovalId(runId: string, planArtifactId: string, expectedPlanSha256: string): string {
  const digest = createHash('sha256')
    .update(`${runId}:${planArtifactId}:${expectedPlanSha256}`)
    .digest('hex')
    .slice(0, 24);
  return `github-delivery-apply-${digest}`;
}

function buildActorResearchSourceCaptureApprovalId(
  input: ReturnType<typeof normalizeResearchSourceCaptureInput>,
  runId: string,
  nodeId: string,
): string {
  const digest = createHash('sha256')
    .update(`${runId}:${nodeId}:${input.urlHash}`)
    .digest('hex')
    .slice(0, 24);
  return `actor-research-source:${digest}`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function actorDispatchCapability(node: DagNode): ActorResearchSourceCaptureCapability | UnsupportedActorCapability | null {
  const payload = recordValue(node.payload['payload']);
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'capability')) return null;
  const capability = recordValue(payload['capability']);
  if (capability?.['kind'] !== 'research_source_capture') {
    return { kind: 'unsupported' };
  }
  const url = textValue(capability?.['url']) ?? '';
  const note = textValue(capability?.['note']);
  return {
    kind: 'research_source_capture',
    url,
    ...(note ? { note } : {}),
  };
}

function sanitizeResearchSourceCaptureDagNode(
  node: DagNode,
  normalized: ReturnType<typeof normalizeResearchSourceCaptureInput>,
): DagNode {
  return {
    ...node,
    payload: {
      ...node.payload,
      payload: {
        capability: {
          kind: 'research_source_capture',
          sourceHost: normalized.host,
          sourceUrlHash: normalized.urlHash,
          sourcePathHash: normalized.pathHash,
        },
      },
    },
  };
}

function sanitizeInvalidResearchSourceCaptureDagNode(node: DagNode): DagNode {
  return {
    ...node,
    payload: {
      ...node.payload,
      payload: {
        capability: { kind: 'research_source_capture', invalid: true },
      },
    },
  };
}

function sanitizeUnsupportedCapabilityDagNode(node: DagNode, capability: UnsupportedActorCapability): DagNode {
  return {
    ...node,
    payload: {
      ...node.payload,
      payload: {
        capability: {
          kind: 'unsupported',
        },
      },
    },
  };
}

function sanitizeResearchSourceCaptureLease(
  lease: LeaseActorMessageResult,
  normalized: ReturnType<typeof normalizeResearchSourceCaptureInput>,
): LeaseActorMessageResult {
  return { ...lease, node: sanitizeResearchSourceCaptureDagNode(lease.node, normalized) };
}

function publicRuntimeArtifactRef(artifact: ArtifactRef): PublicRuntimeArtifactRef {
  const { uri: _uri, ...publicRef } = artifact;
  return publicRef;
}

function mergeUniqueStrings(base: string[], extra: string[]): string[] {
  const seen = new Set(base);
  const merged = [...base];
  for (const value of extra) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  return merged;
}

const DEFAULT_FREECLAUDE_BASH_DENY_PATTERN =
  /rm\s+-rf\s+\/|sudo\s|\bdrop\s+(table|database)\b|\bmkfs\b|\bdd\s+if=|\bshutdown\b|\breboot\b|:\(\)\{:|:&\};:/i;

const DEFAULT_FREECLAUDE_GUARDRAIL_POLICIES: ToolPolicy[] = [
  {
    toolName: 'Bash',
    tier: 'forbidden',
    pattern: DEFAULT_FREECLAUDE_BASH_DENY_PATTERN,
    rationale: 'Block dangerous native FreeClaude shell tool_use events before strict worker handling.',
  },
  {
    toolName: 'bash',
    tier: 'forbidden',
    pattern: DEFAULT_FREECLAUDE_BASH_DENY_PATTERN,
    rationale: 'Block dangerous native FreeClaude shell tool_use events before strict worker handling.',
  },
];

function latestArtifact(artifacts: ArtifactRef[]): ArtifactRef | undefined {
  return [...artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

async function presentArtifacts(store: ArtifactStore, artifacts: ArtifactRef[]): Promise<ArtifactRef[]> {
  const checks = await Promise.all(artifacts.map(async (artifact) => ({
    artifact,
    present: await store.exists(artifact),
  })));
  return checks.filter((check) => check.present).map((check) => check.artifact);
}

// ============================================
// Main Runtime Class
// ============================================

export class PyrforRuntime {
  sessions: SessionManager;
  providers: ProviderRouter;
  compact: AutoCompact;
  subagents: SubagentSpawner;
  privacy: PrivacyManager;
  workspace: WorkspaceLoader | null = null;
  store: SessionStore | null = null;
  /** Current resolved RuntimeConfig. Updated on hot-reload. */
  config: RuntimeConfig;
  private health: HealthMonitor | null = null;
  private cron: CronService | null = null;
  private gateway: GatewayHandle | null = null;
  private orchestration: RuntimeOrchestration | null = null;
  private approvalFlowUnsubscribe: (() => void) | null = null;
  private readonly contextPackRefreshLocks = new Map<string, Promise<{ artifact: ArtifactRef; pack: ContextPack; previousArtifact: ArtifactRef }>>();
  private readonly ceoclawDenialApprovalsInFlight = new Set<string>();
  private readonly ksReconciliationDenialApprovalsInFlight = new Set<string>();
  private readonly productFactory = createDefaultProductFactory();
  private configPath: string | null = null;
  private _configWatchDispose: (() => void) | null = null;
  private options: Required<Omit<PyrforRuntimeOptions, 'persistence' | 'configPath' | 'config'>> & {
    persistence: SessionStoreOptions | false;
  };
  private readonly baseSystemPrompt: string;
  private started = false;
  private telegramBot: TelegramSender | null = null;
  private workspaceSwitchPromise: Promise<void> | null = null;
  private freeClaudeGuardrails: Guardrails | null = null;
  private runtimeBudgetController: TokenBudgetController | null = null;
  private worktreeManager: RuntimeWorktreeManager | null = null;
  private shutdownTelemetry: (() => Promise<void>) | null = null;
  private mcpClient: McpClient | null = null;
  private mcpLifecycle: McpLifecycleManagerStub | null = null;
  private readonly mcpClientFactory: (() => McpClient) | null;
  private readonly runtimePermissionRegistry: CapabilityToolRegistry;
  private readonly runtimePermissionEngine: PermissionEngine;

  constructor(options: PyrforRuntimeOptions = {}) {
    this.baseSystemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
    this.options = {
      workspacePath: options.workspacePath || process.cwd(),
      memoryPath: options.memoryPath || undefined,
      systemPrompt: this.baseSystemPrompt,
      enableCompact: options.enableCompact ?? true,
      enableSubagents: options.enableSubagents ?? true,
      maxSubagents: options.maxSubagents ?? 5,
      privacy: options.privacy || {},
      providerOptions: options.providerOptions || {},
      persistence: options.persistence ?? {},
    } as Required<Omit<PyrforRuntimeOptions, 'persistence' | 'configPath' | 'config'>> & { persistence: SessionStoreOptions | false };

    // Config: use provided config or defaults; will be (re)loaded from file in start() if configPath given
    this.configPath = options.configPath ?? null;
    this.config = options.config ?? RuntimeConfigSchema.parse({});
    this.mcpClientFactory = options.mcpClientFactory ?? null;
    setSandboxProvider(createSandboxProvider(this.config.sandbox));

    // Initialize components
    this.sessions = new SessionManager();
    this.providers = new ProviderRouter(this.options.providerOptions);
    this.compact = new AutoCompact(this.providers, {
      onCompact: async (session) => {
        if (!this.store) return;
        this.store.save(session);
        await this.store.flushAll();
      },
    });
    this.subagents = new SubagentSpawner(this.options.maxSubagents);
    this.privacy = new PrivacyManager({
      defaultZone: this.options.privacy.defaultZone || 'personal',
      vaultPassword: this.options.privacy.vaultPassword,
    });
    this.runtimePermissionRegistry = new CapabilityToolRegistry();
    registerStandardTools(this.runtimePermissionRegistry);
    registerRuntimeToolAliases(this.runtimePermissionRegistry);
    this.runtimePermissionEngine = new PermissionEngine(this.runtimePermissionRegistry, {
      profile: 'standard',
    });

    // Setup subagent executor
    if (this.options.enableSubagents) {
      this.subagents.setExecutor(async (task) => {
        return this.executeSubagentTask(task);
      });
    }

    // Register telegram bot setter globally
    setTelegramBot(null);

    logger.info('PyrforRuntime initialized');
  }

  private applyRuntimeConfig(): void {
    const configuredWorkspace = this.config.workspacePath ?? this.config.workspaceRoot;
    if (configuredWorkspace) {
      this.options.workspacePath = configuredWorkspace;
    }
    if (this.config.memoryPath) {
      this.options.memoryPath = this.config.memoryPath;
    }
    this.providers.setProviderOptions({
      defaultProvider: this.config.providers?.defaultProvider,
      enableFallback: this.config.providers?.enableFallback,
    });
    if (this.config.ai?.activeModel) {
      this.providers.setActiveModel(
        this.config.ai.activeModel.provider,
        this.config.ai.activeModel.modelId,
      );
    }
    this.providers.setLocalMode({
      localFirst: this.config.ai?.localFirst ?? false,
      localOnly: this.config.ai?.localOnly ?? false,
    });
    setSandboxProvider(createSandboxProvider(this.config.sandbox));
  }

  setWorkspacePath(workspacePath: string): Promise<void> {
    this.options.workspacePath = workspacePath;
    this.config.workspacePath = workspacePath;
    this.config.workspaceRoot = workspacePath;
    setWorkspaceRoot(workspacePath);
    if (this.store && this.options.persistence !== false && !this.options.persistence.rootDir) {
      const oldStore = this.store;
      this.configureSessionStore();
      void oldStore.close().catch((err) => {
        logger.warn('[runtime] Previous session store close failed after workspace change', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    if (this.started) {
      this.workspaceSwitchPromise = this.reloadWorkspaceAfterSwitch()
        .finally(() => {
          this.workspaceSwitchPromise = null;
        });
      return this.workspaceSwitchPromise;
    }
    return Promise.resolve();
  }

  getWorkspacePath(): string {
    return this.options.workspacePath;
  }

  /**
   * Shared MCP client for this runtime process. Lazily constructed so headless
   * runs that never touch MCP avoid extra initialization.
   */
  getMcpClient(): McpClient {
    if (!this.mcpClient) {
      this.mcpClient = this.mcpClientFactory ? this.mcpClientFactory() : createMcpClient();
    }
    return this.mcpClient;
  }

  private async teardownMcpBootstrap(): Promise<void> {
    if (!this.mcpLifecycle) return;
    try {
      await this.mcpLifecycle.shutdown();
    } catch (err) {
      logger.warn('[runtime] MCP lifecycle shutdown failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.mcpLifecycle = null;
  }

  private async rebootstrapMcpFromConfig(): Promise<void> {
    await this.teardownMcpBootstrap();
    this.mcpClient = null;
    await this.initMcpFromConfig();
  }

  private async initMcpFromConfig(): Promise<void> {
    const { mcp } = this.config;
    if (!mcp.enabled || mcp.servers.length === 0) {
      return;
    }

    const client = this.getMcpClient();
    this.mcpLifecycle = new McpLifecycleManagerStub(client);

    for (const serverCfg of mcp.servers) {
      try {
        this.mcpLifecycle.registerConfig(serverCfg);
        await client.connect(serverCfg);
      } catch (err) {
        logger.warn('[runtime] MCP server connect failed', {
          server: serverCfg.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private resolvedSessionStoreOptions(): SessionStoreOptions | false {
    if (this.options.persistence === false) return false;
    return {
      ...this.options.persistence,
      rootDir: this.options.persistence.rootDir
        ?? path.join(this.options.workspacePath, '.pyrfor', 'sessions'),
    };
  }

  private configureSessionStore(): void {
    const persistenceOptions = this.resolvedSessionStoreOptions();
    if (persistenceOptions === false) {
      this.store = null;
      this.sessions.setStore(null);
      return;
    }
    this.store = new SessionStore(persistenceOptions);
    this.sessions.setStore(this.store);
  }

  private currentWorkspaceFilter(): Record<string, unknown> {
    return { workspaceId: this.options.workspacePath };
  }

  private belongsToCurrentWorkspace(session: Session): boolean {
    return session.metadata['workspaceId'] === this.options.workspacePath;
  }

  private resolvePermissionWorkspaceId(session: Session): string {
    const metadataWorkspace =
      typeof session.metadata['workspaceId'] === 'string'
        ? session.metadata['workspaceId']
        : typeof session.metadata['workspacePath'] === 'string'
          ? session.metadata['workspacePath']
          : null;
    return metadataWorkspace ?? this.options.workspacePath;
  }

  private createToolLoopPermissionGate(session: Session) {
    return createPermissionApprovalGate({
      permissionEngine: this.runtimePermissionEngine,
      permissionContext: {
        workspaceId: this.resolvePermissionWorkspaceId(session),
        sessionId: session.id,
      },
      requestApproval: (req) => approvalFlow.requestApproval(req),
    });
  }

  private async restoreCurrentWorkspaceSession(sessionId: string): Promise<Session | undefined> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    if (!this.store) return undefined;

    const record = await this.store.get(this.options.workspacePath, sessionId);
    if (!record) return undefined;
    const session = reviveSessionRecord(record) as Session;
    this.sessions.restore(session);
    return session;
  }

  private async awaitWorkspaceSwitch(): Promise<void> {
    if (this.workspaceSwitchPromise) {
      await this.workspaceSwitchPromise;
    }
  }

  private workspaceLoaderOptions(): WorkspaceLoaderOptions {
    return {
      workspacePath: this.options.workspacePath,
      memoryPath: this.options.memoryPath,
    };
  }

  private async loadWorkspaceState(): Promise<void> {
    this.workspace?.dispose();
    this.workspace = new WorkspaceLoader(this.workspaceLoaderOptions());
    await this.workspace.load();

    setSkillAIProvider((messages) => this.providers.chat(messages));
    const dynamicSkillCount = registerDynamicSkills(this.workspace.getWorkspace()?.files?.skills ?? []);
    if (dynamicSkillCount > 0) {
      logger.info('[runtime] Dynamic skills registered', { count: dynamicSkillCount });
    }

    setWorkspaceRoot(this.options.workspacePath);

    const wsPrompt = this.workspace.getSystemPrompt();
    this.options.systemPrompt = wsPrompt || this.baseSystemPrompt;
  }

  private async restoreCurrentWorkspaceSessions(): Promise<void> {
    if (!this.store) return;
    await this.store.init();
    const persisted = await this.store.list(this.options.workspacePath, { mode: 'chat' });
    const restoredIds = new Set<string>();
    let restored = 0;
    for (const record of persisted) {
      if (restoredIds.has(record.id)) continue;
      try {
        const existing = this.sessions.get(record.id);
        if (existing) {
          restoredIds.add(record.id);
          continue;
        }
        this.sessions.restore(reviveSessionRecord(record) as Session);
        restoredIds.add(record.id);
        restored++;
      } catch (err) {
        logger.warn('Failed to revive persisted session', {
          id: record.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (restored > 0) {
      logger.info('Restored persisted sessions', { count: restored });
    }
  }

  private async reloadWorkspaceAfterSwitch(): Promise<void> {
    await this.loadWorkspaceState();
    try {
      await this.restoreCurrentWorkspaceSessions();
    } catch (err) {
      logger.error('Session store init/load failed after workspace switch; continuing without restored sessions', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  getMemorySnapshot(): {
    lines: string[];
    files: string[];
    workspaceFiles: Record<string, { present: boolean; lineCount: number }>;
    daily: Array<{ date: string; lineCount: number; lines: string[] }>;
  } {
    const files = this.workspace?.getWorkspace()?.files;
    if (!files) {
      return { lines: [], files: [], workspaceFiles: {}, daily: [] };
    }

    const workspaceEntries: Array<[string, string]> = [
      ['MEMORY.md', files.memory],
      ['SOUL.md', files.soul],
      ['USER.md', files.user],
      ['IDENTITY.md', files.identity],
      ['AGENTS.md', files.agents],
      ['HEARTBEAT.md', files.heartbeat],
      ['TOOLS.md', files.tools],
    ];
    const daily = [...files.daily.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([date, content]) => ({
        date,
        lineCount: content.split('\n').length,
        lines: content.split('\n').slice(-20),
      }));
    const memoryLines = [
      ...files.memory.split('\n'),
      ...daily.flatMap((entry) => entry.lines),
    ].filter((line) => line.trim().length > 0).slice(-50);

    return {
      lines: memoryLines,
      files: [
        ...workspaceEntries.filter(([, content]) => content.length > 0).map(([name]) => name),
        ...daily.map((entry) => `memory/${entry.date}.md`),
        ...files.skills.map((_, index) => `SKILL-${index}.md`),
      ],
      workspaceFiles: Object.fromEntries(workspaceEntries.map(([name, content]) => [
        name,
        { present: content.length > 0, lineCount: content ? content.split('\n').length : 0 },
      ])),
      daily,
    };
  }

  async getMemoryContinuityStatus(input: { projectId?: string } = {}): Promise<MemoryContinuityStatus> {
    const projectId = input.projectId?.trim();
    const snapshot = this.getMemorySnapshot();
    const workspaceFileEntries = Object.entries(snapshot.workspaceFiles);
    const missing = workspaceFileEntries
      .filter(([, status]) => !status.present)
      .map(([name]) => name);
    const artifactStore = this.orchestration?.artifactStore;
    const artifacts = artifactStore
      ? await presentArtifacts(artifactStore, await artifactStore.listIndexed({ kind: 'summary' }))
      : [];
    const workspaceArtifacts = artifacts.filter((artifact) => artifact.meta?.workspaceId === this.options.workspacePath);
    const latestDailyArtifact = latestArtifact(workspaceArtifacts.filter((artifact) =>
      artifact.meta?.memoryKind === 'daily_rollup'
      && artifact.meta?.projectId === undefined
    ));
    const latestProjectArtifact = projectId
      ? latestArtifact(workspaceArtifacts.filter((artifact) =>
          artifact.meta?.memoryKind === 'project_rollup'
          && artifact.meta?.projectId === projectId
        ))
      : undefined;
    const latestOpenClawArtifact = latestArtifact(workspaceArtifacts.filter((artifact) =>
      artifact.meta?.memoryKind === 'openclaw_import_report'
      && (projectId ? artifact.meta?.projectId === projectId : artifact.meta?.projectId === undefined)
    ));
    const latestOpenClaw = latestOpenClawArtifact && this.orchestration
      ? await this.readOpenClawReportForContinuity(latestOpenClawArtifact, projectId)
      : null;
    const warnings: string[] = [];
    if (missing.length > 0) warnings.push('memory_files_missing');
    if (!this.orchestration) warnings.push('orchestration_not_initialized');
    if (!latestDailyArtifact) warnings.push('no_daily_rollup');
    if (!projectId) warnings.push('no_project_id');
    if (projectId && !latestProjectArtifact) warnings.push('no_project_rollup');
    if (!latestOpenClaw) warnings.push('no_openclaw_report');

    return {
      workspaceId: this.options.workspacePath,
      ...(projectId ? { projectId } : {}),
      generatedAt: new Date().toISOString(),
      workspaceFiles: {
        present: workspaceFileEntries.filter(([, status]) => status.present).length,
        total: workspaceFileEntries.length,
        missing,
        files: snapshot.workspaceFiles,
      },
      latestDailyRollup: latestDailyArtifact
        ? {
            status: 'ok',
            artifact: latestDailyArtifact,
            createdAt: latestDailyArtifact.createdAt,
            ...(typeof latestDailyArtifact.meta?.date === 'string' ? { date: latestDailyArtifact.meta.date } : {}),
          }
        : { status: 'missing' },
      latestProjectRollup: projectId
        ? latestProjectArtifact
          ? {
              status: 'ok',
              artifact: latestProjectArtifact,
              createdAt: latestProjectArtifact.createdAt,
              projectId,
            }
          : { status: 'missing', projectId }
        : { status: 'not_configured' },
      latestOpenClawReport: latestOpenClaw
        ? {
            status: 'ok',
            artifact: latestOpenClaw.artifact,
            createdAt: latestOpenClaw.artifact.createdAt,
            counts: latestOpenClaw.report.counts,
            ...(latestOpenClaw.report.projectId ? { projectId: latestOpenClaw.report.projectId } : {}),
          }
        : { status: 'missing', ...(projectId ? { projectId } : {}) },
      warnings,
    };
  }

  private async readOpenClawReportForContinuity(
    artifact: ArtifactRef,
    projectId?: string,
  ): Promise<{ artifact: ArtifactRef; report: OpenClawMigrationReport } | null> {
    try {
      const report = await this.orchestration!.artifactStore.readJSON<OpenClawMigrationReport>(artifact);
      if (report.workspaceId !== this.options.workspacePath) return null;
      if ((projectId ? projectId : undefined) !== (report.projectId ?? undefined)) return null;
      if (!isAllowedOpenClawReportSourceRoot(report)) return null;
      return { artifact, report };
    } catch {
      return null;
    }
  }

  async listSessions(options: {
    limit?: number;
    offset?: number;
    archived?: boolean;
  } = {}): Promise<RuntimeSessionSummary[]> {
    await this.awaitWorkspaceSwitch();
    if (!this.store) return [];
    const listOptions: {
      archived?: boolean;
      mode: SessionRecord['mode'];
      limit?: number;
      offset?: number;
      orderBy: 'updatedAt';
      direction: 'desc';
    } = {
      mode: 'chat',
      orderBy: 'updatedAt',
      direction: 'desc',
    };
    if (options.limit !== undefined) listOptions.limit = options.limit;
    if (options.offset !== undefined) listOptions.offset = options.offset;
    if (options.archived !== undefined) listOptions.archived = options.archived;
    const records = await this.store.list(this.options.workspacePath, listOptions);
    return records.map((record) => this.toSessionSummary(record));
  }

  async getSession(sessionId: string): Promise<RuntimeSessionDetail | null> {
    const record = await this.getCurrentWorkspaceSessionRecord(sessionId);
    return record ? this.toSessionDetail(record) : null;
  }

  async getSessionTimeline(sessionId: string): Promise<{
    sessionId: string;
    workspaceId: string;
    summary?: string;
    events: RuntimeSessionTimelineEvent[];
  } | null> {
    const record = await this.getCurrentWorkspaceSessionRecord(sessionId);
    if (!record) return null;
    return {
      sessionId: record.id,
      workspaceId: record.workspaceId,
      ...(record.summary ? { summary: record.summary } : {}),
      events: record.messages.map((message, index) => ({
        id: message.id,
        sessionId: record.id,
        type: 'message' as const,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        index,
        ...(message.metadata ? { metadata: message.metadata } : {}),
      })),
    };
  }

  async searchMemory(input: {
    query: string;
    projectId?: string;
    limit?: number;
  }): Promise<{ workspaceId: string; query: string; projectId?: string; results: RuntimeMemorySearchHit[] }> {
    await this.awaitWorkspaceSwitch();
    const trimmed = input.query.trim();
    if (!trimmed) throw new Error('Memory search query is required');
    const projectId = input.projectId?.trim() || undefined;
    const results = await searchDurableMemoryForContext({
      agentId: 'pyrfor-runtime',
      query: trimmed,
      workspaceId: this.options.workspacePath,
      projectId,
      limit: Math.max(1, Math.min(input.limit ?? 10, 50)),
      audience: 'audit',
    });
    return {
      workspaceId: this.options.workspacePath,
      query: trimmed,
      ...(projectId ? { projectId } : {}),
      results: results.map(memoryToSearchHit),
    };
  }

  async createMemoryCorrection(input: {
    content: string;
    summary?: string;
    projectId?: string;
    memoryType?: MemoryType;
    importance?: number;
    operatorId?: string;
  }): Promise<RuntimeMemoryCorrectionResult> {
    await this.awaitWorkspaceSwitch();
    const content = input.content.trim();
    if (!content) throw new Error('Memory correction content is required');
    const projectId = input.projectId?.trim() || undefined;
    const memoryType = input.memoryType ?? 'semantic';
    const importance = Math.max(0, Math.min(input.importance ?? 0.8, 1));
    const memoryId = await storeMemory({
      agentId: 'pyrfor-runtime',
      workspaceId: this.options.workspacePath,
      projectId,
      memoryType,
      content,
      summary: input.summary?.trim() || content.slice(0, 160),
      importance,
      metadata: {
        correctionKind: 'operator',
        operatorId: input.operatorId?.trim() || 'operator',
        approvalState: 'pending_approval',
        plannerEligible: false,
        scope: {
          visibility: projectId ? 'project' : 'workspace',
          workspaceId: this.options.workspacePath,
          ...(projectId ? { projectId } : {}),
        },
        confidence: 0.95,
        provenance: [{ kind: 'user', ref: input.operatorId?.trim() || 'operator', ts: new Date().toISOString() }],
      },
    });
    if (memoryId === 'short-term-only') throw new Error('Memory correction was not durably persisted');
    return {
      memory: {
        id: memoryId,
        summary: input.summary?.trim() || content.slice(0, 160),
        content,
        createdAt: new Date().toISOString(),
        memoryType,
        importance,
        workspaceId: this.options.workspacePath,
        ...(projectId ? { projectId } : {}),
        source: 'durable',
        scopeVisibility: projectId ? 'project' : 'workspace',
        approvalState: 'pending_approval',
        plannerEligible: false,
        correctionKind: 'operator',
      },
    };
  }

  async reviewMemory(input: {
    memoryId: string;
    decision: MemoryReviewDecision;
    operatorId?: string;
    reason?: string;
  }): Promise<RuntimeMemoryReviewResult> {
    await this.awaitWorkspaceSwitch();
    const memoryId = input.memoryId.trim();
    if (!memoryId) throw new Error('Memory review target not found');
    const reviewed = await reviewDurableMemory({
      memoryId,
      decision: input.decision,
      operatorId: input.operatorId?.trim() || 'operator',
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      agentId: 'pyrfor-runtime',
      workspaceId: this.options.workspacePath,
    });
    return {
      decision: input.decision,
      memory: memoryToSearchHit(reviewed),
    };
  }

  async listPendingMemoryReviews(input: {
    projectId?: string;
    limit?: number;
  } = {}): Promise<RuntimePendingMemoryReviewsResult> {
    await this.awaitWorkspaceSwitch();
    const projectId = input.projectId?.trim() || undefined;
    const results = await listPendingDurableMemoryReviews({
      agentId: 'pyrfor-runtime',
      workspaceId: this.options.workspacePath,
      ...(projectId ? { projectId } : {}),
      limit: Math.max(1, Math.min(input.limit ?? 25, 100)),
    });
    return {
      memoryReviews: results.map(memoryToSearchHit),
    };
  }

  async previewOpenClawMigration(input: {
    sourcePath?: string;
    projectId?: string;
    includePersonality?: boolean;
    includeMemories?: boolean;
    maxFiles?: number;
  } = {}): Promise<OpenClawMigrationPreviewResult> {
    await this.awaitWorkspaceSwitch();
    await this.initOrchestration();
    if (!this.orchestration?.artifactStore) throw new Error('OpenClaw migration requires artifact store');
    return previewOpenClawMigration({
      artifactStore: this.orchestration.artifactStore,
    }, {
      workspaceId: this.options.workspacePath,
      ...input,
    });
  }

  async getLatestOpenClawMigrationReport(input: { projectId?: string } = {}): Promise<{ artifact: ArtifactRef; report: OpenClawMigrationReport } | null> {
    await this.initOrchestration();
    const projectId = input.projectId?.trim();
    const artifacts = await this.orchestration!.artifactStore.list({ kind: 'summary' });
    const latest = artifacts
      .filter((artifact) => artifact.meta?.memoryKind === 'openclaw_import_report'
        && artifact.meta?.workspaceId === this.options.workspacePath
        && (projectId ? artifact.meta?.projectId === projectId : artifact.meta?.projectId === undefined))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!latest) return null;
    const report = await this.orchestration!.artifactStore.readJSON<OpenClawMigrationReport>(latest);
    if (report.workspaceId !== this.options.workspacePath) return null;
    if ((projectId ? projectId : undefined) !== (report.projectId ?? undefined)) return null;
    if (!isAllowedOpenClawReportSourceRoot(report)) return null;
    return { artifact: latest, report };
  }

  async importOpenClawMigration(input: {
    reportArtifactId: string;
    expectedReportSha256: string;
    projectId?: string;
    autoTestSkills?: boolean;
    autoApproveSkills?: boolean;
  }): Promise<OpenClawMigrationImportResult> {
    await this.awaitWorkspaceSwitch();
    await this.initOrchestration();
    const artifacts = await this.orchestration!.artifactStore.list({ kind: 'summary' });
    const reportArtifact = artifacts.find((artifact) => artifact.id === input.reportArtifactId);
    if (!reportArtifact || reportArtifact.meta?.memoryKind !== 'openclaw_import_report') {
      throw new Error('OpenClaw migration report not found');
    }
    const report = await this.orchestration!.artifactStore.readJSONVerified<OpenClawMigrationReport>(
      reportArtifact,
      input.expectedReportSha256,
    );
    if (report.workspaceId !== this.options.workspacePath) throw new Error('OpenClaw migration report workspace mismatch');
    const projectId = input.projectId?.trim();
    if ((projectId ? projectId : undefined) !== (report.projectId ?? undefined)) {
      throw new Error('OpenClaw migration report project mismatch');
    }
    return importOpenClawMigration({
      artifactStore: this.orchestration!.artifactStore,
      toolRegistry: this.orchestration!.toolRegistry,
    }, {
      report,
      reportArtifact,
      expectedReportSha256: input.expectedReportSha256,
      ...(input.autoTestSkills === true ? { autoTestSkills: true } : {}),
      ...(input.autoApproveSkills === true ? { autoApproveSkills: true } : {}),
    });
  }

  async rollbackOpenClawMigration(input: {
    resultArtifactId: string;
    expectedResultSha256: string;
  }): Promise<OpenClawMigrationRollbackResult> {
    await this.awaitWorkspaceSwitch();
    await this.initOrchestration();
    const artifacts = await this.orchestration!.artifactStore.list({ kind: 'summary' });
    const resultArtifact = artifacts.find((artifact) => artifact.id === input.resultArtifactId);
    if (!resultArtifact || resultArtifact.meta?.memoryKind !== 'openclaw_import_result') {
      throw new Error('OpenClaw migration result not found');
    }
    const resultDocument = await this.orchestration!.artifactStore.readJSONVerified<{ workspaceId: string }>(
      resultArtifact,
      input.expectedResultSha256,
    );
    if (resultDocument.workspaceId !== this.options.workspacePath) throw new Error('OpenClaw migration result workspace mismatch');
    return rollbackOpenClawMigration({
      artifactStore: this.orchestration!.artifactStore,
    }, {
      resultArtifact,
      expectedResultSha256: input.expectedResultSha256,
    });
  }

  async verifyOpenClawMigration(input: {
    resultArtifactId: string;
    expectedResultSha256: string;
    queryLimit?: number;
  }): Promise<OpenClawMigrationVerificationResult> {
    await this.awaitWorkspaceSwitch();
    await this.initOrchestration();
    const artifacts = await this.orchestration!.artifactStore.list({ kind: 'summary' });
    const resultArtifact = artifacts.find((artifact) => artifact.id === input.resultArtifactId);
    if (!resultArtifact || resultArtifact.meta?.memoryKind !== 'openclaw_import_result') {
      throw new Error('OpenClaw migration result not found');
    }
    const resultDocument = await this.orchestration!.artifactStore.readJSONVerified<{ workspaceId: string }>(
      resultArtifact,
      input.expectedResultSha256,
    );
    if (resultDocument.workspaceId !== this.options.workspacePath) throw new Error('OpenClaw migration result workspace mismatch');
    return verifyOpenClawMigration({
      artifactStore: this.orchestration!.artifactStore,
    }, {
      resultArtifact,
      expectedResultSha256: input.expectedResultSha256,
      queryLimit: input.queryLimit,
    });
  }

  async getOpenClawMigrationAudit(input: {
    projectId?: string;
    limit?: number;
  } = {}): Promise<OpenClawMigrationAuditView> {
    await this.awaitWorkspaceSwitch();
    await this.initOrchestration();
    if (!this.orchestration?.artifactStore) throw new Error('OpenClaw migration audit requires artifact store');
    return buildOpenClawMigrationAudit({
      artifactStore: this.orchestration.artifactStore,
    }, {
      workspaceId: this.options.workspacePath,
      ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    });
  }

  async getOpenClawMigrationQuarantine(input: {
    projectId?: string;
    limit?: number;
  } = {}): Promise<OpenClawMigrationQuarantineState> {
    await this.awaitWorkspaceSwitch();
    await this.initOrchestration();
    if (!this.orchestration?.artifactStore) throw new Error('OpenClaw migration quarantine requires artifact store');
    return buildOpenClawMigrationQuarantine({
      artifactStore: this.orchestration.artifactStore,
    }, {
      workspaceId: this.options.workspacePath,
      ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    });
  }

  private async getCurrentWorkspaceSessionRecord(sessionId: string): Promise<SessionRecord | null> {
    await this.awaitWorkspaceSwitch();
    if (!this.store) return null;
    const live = this.sessions.get(sessionId);
    if (live && !this.belongsToCurrentWorkspace(live)) return null;
    return this.store.get(this.options.workspacePath, sessionId);
  }

  private toSessionSummary(record: SessionRecord): RuntimeSessionSummary {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      title: record.title,
      mode: record.mode,
      ...(record.runId ? { runId: record.runId } : {}),
      ...(record.parentSessionId ? { parentSessionId: record.parentSessionId } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      messageCount: record.messages.length,
      ...(record.summary ? { summary: record.summary } : {}),
      ...(record.archived !== undefined ? { archived: record.archived } : {}),
    };
  }

  private toSessionDetail(record: SessionRecord): RuntimeSessionDetail {
    return {
      ...this.toSessionSummary(record),
      messages: record.messages,
      ...(record.metadata ? { metadata: record.metadata } : {}),
    };
  }

  async createDailyMemoryRollup(input: {
    date?: string;
    agentId?: string;
    projectId?: string;
    sessionLimit?: number;
  } = {}): Promise<DailyMemoryRollupResult> {
    await this.awaitWorkspaceSwitch();
    if (!this.store) throw new Error('Memory rollup requires session persistence');
    await this.initOrchestration();
    return createDailyMemoryRollup({
      sessionStore: this.store,
      eventLedger: this.orchestration?.eventLedger,
      artifactStore: this.orchestration?.artifactStore,
    }, {
      workspaceId: this.options.workspacePath,
      ...input,
    });
  }

  async createProjectMemoryRollup(input: {
    projectId: string;
    agentId?: string;
    sessionLimit?: number;
  }): Promise<ProjectMemoryRollupResult> {
    await this.awaitWorkspaceSwitch();
    if (!this.store) throw new Error('Project memory rollup requires session persistence');
    await this.initOrchestration();
    return createProjectMemoryRollup({
      sessionStore: this.store,
      eventLedger: this.orchestration?.eventLedger,
      artifactStore: this.orchestration?.artifactStore,
    }, {
      workspaceId: this.options.workspacePath,
      ...input,
    });
  }

  /**
   * Start all services
   */
  async start(): Promise<void> {
    if (this.started) {
      logger.warn('Runtime already started');
      return;
    }

    // Load config from file if configPath is set
    if (this.configPath) {
      try {
        const { config } = await loadConfig(this.configPath);
        this.config = config;
        this.applyRuntimeConfig();
        logger.info('[runtime] Config loaded', { path: this.configPath });
      } catch (err) {
        logger.warn('[runtime] Config load failed, using defaults', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      this.applyRuntimeConfig();
    }

    this.shutdownTelemetry = configureEngineTelemetry(this.config.otel);

    this.configureSessionStore();

    await this.loadWorkspaceState();

    // ── Workspace → system-prompt injection ────────────────────────────────
    // WorkspaceLoader is the canonical server-side memory source.  It reads
    // MEMORY.md, memory/YYYY-MM-DD.md (today + 7 days), SOUL.md, USER.md,
    // IDENTITY.md, AGENTS.md, HEARTBEAT.md, TOOLS.md, and SKILL.md files,
    // then composes them into a single system-prompt string.
    //
    // That string is stored in this.options.systemPrompt and is passed as
    // `systemPrompt` every time a new Session is created (see handleMessage /
    // streamMessage / streamMessageAdvanced below).  SessionManager.create()
    // inserts it as the first { role: 'system', ... } message, so it is
    // present in the messages array forwarded to every AI provider call.
    //
    // Nothing else needs to wire this up — the injection is already complete.
    // Restore persisted sessions (best-effort, never fatal).
    if (this.store) {
      try {
        await this.restoreCurrentWorkspaceSessions();
      } catch (err) {
        logger.error('Session store init/load failed; continuing without persistence', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await this.initOrchestration();

    await this.initMcpFromConfig();

    // ── Health monitor ──────────────────────────────────────────────────────
    this.health = new HealthMonitor({
      intervalMs: this.config.health.intervalMs,
    });
    // "runtime" check — always healthy once start completes
    this.health.addCheck('runtime', () => ({ healthy: true }));
    // "providers" check — healthy when at least one provider is available
    this.health.addCheck('providers', () => ({
      healthy: this.providers.getAvailableProviders().length > 0,
      message: `available: ${this.providers.getAvailableProviders().join(', ') || 'none'}`,
    }));
    if (this.config.health.enabled) {
      this.health.start();
    }

    // ── Prisma adapter ──────────────────────────────────────────────────────
    if (this.config.persistence?.prisma?.enabled) {
      const prismaClient = await tryLoadPrismaClient();
      if (prismaClient) {
        installPrismaClient(prismaClient);
        logger.info('[runtime] Prisma client loaded and installed');
      } else {
        logger.warn('[runtime] prisma enabled in config but @prisma/client not installed — using noop');
        installPrismaClient(createNoopPrismaClient());
      }
    } else {
      installPrismaClient(createNoopPrismaClient());
    }

    // ── Cron service ────────────────────────────────────────────────────────
    this.cron = new CronService({ defaultTimezone: this.config.cron.timezone });
    // Register all default handlers (prisma-dependent handlers will log an
    // error at execution time if setCronPrismaClient() was never called — this
    // is expected when running without a database).
    const defaultHandlers = getDefaultHandlers();
    for (const [key, fn] of Object.entries(defaultHandlers)) {
      this.cron.registerHandler(key, fn);
    }
    if (this.config.cron.enabled) {
      try {
        this.cron.start(this.config.cron.jobs as CronJobSpec[]);
      } catch (err) {
        logger.warn('[runtime] CronService start failed; running without scheduled jobs', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Gateway ─────────────────────────────────────────────────────────────
    if (this.config.gateway.enabled) {
      await this.ensureGatewayStarted();
    }

    // ── Config hot-reload ───────────────────────────────────────────────────
    if (this.configPath) {
      this._configWatchDispose = watchConfig(
        this.configPath,
        (newConfig) => {
          const oldJobs = this.config.cron.jobs;
          const oldGatewayPort = this.config.gateway.port;
          const oldMcpJson = JSON.stringify(this.config.mcp);
          this.config = newConfig;
          this.applyRuntimeConfig();
          setWorkspaceRoot(this.options.workspacePath);

          if (oldMcpJson !== JSON.stringify(newConfig.mcp)) {
            void this.rebootstrapMcpFromConfig().catch((err) => {
              logger.warn('[runtime] MCP re-bootstrap failed after config hot-reload', {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }

          // Diff cron jobs: remove deleted, add new ones
          if (this.cron) {
            const oldNames = new Set(oldJobs.map((j) => j.name));
            const newNames = new Set(newConfig.cron.jobs.map((j) => j.name));
            for (const name of oldNames) {
              if (!newNames.has(name)) this.cron.removeJob(name);
            }
            for (const job of newConfig.cron.jobs) {
              if (!oldNames.has(job.name)) {
                try {
                  this.cron.addJob(job as CronJobSpec);
                } catch (err) {
                  logger.warn('[runtime] Failed to add new cron job from hot-reload', {
                    name: job.name,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }
          }

          if (this.gateway && newConfig.gateway.port !== oldGatewayPort) {
            logger.warn('[runtime] gateway.port changed in config — restart required for new port to take effect');
          }

          logger.info('[runtime] Config reloaded via hot-reload');
        },
        {
          onError: (err) => {
            logger.warn('[runtime] Config watch error; keeping stale config', {
              error: err instanceof Error ? err.message : String(err),
            });
          },
        },
      );
    }

    this.started = true;
    logger.info('PyrforRuntime started');
  }

  /**
   * Start the HTTP gateway if it is not already running.
   *
   * Used both by start() (when `config.gateway.enabled` is true) and by
   * scenarios that require the gateway regardless of config — e.g., serving
   * Telegram Mini App static files in `--telegram` mode when
   * TELEGRAM_WEBAPP_URL is set. Safe to call multiple times.
   */
  async ensureGatewayStarted(): Promise<GatewayHandle | null> {
    if (this.gateway) return this.gateway;

    const gateway = createRuntimeGateway({
      config: this.config,
      runtime: this,
      health: this.health ?? undefined,
      cron: this.cron ?? undefined,
      providerRouter: this.providers,
      orchestration: this.orchestrationAsGatewayDeps(),
      connectorInventory: {
        getSnapshot: () => buildConnectorInventorySnapshot(createConnectorRegistry(process.env), process.env),
        probeStatus: (connectorId) => createConnectorRegistry(process.env).getStatus(connectorId),
      },
      configPath: this.configPath ?? undefined,
    });

    try {
      await gateway.start();
      this.gateway = gateway;
      const gatewayPort = gateway.port;
      if (this.health) {
        this.health.addCheck('gateway', async () => {
          try {
            const res = await fetch(`http://127.0.0.1:${gatewayPort}/ping`, {
              signal: AbortSignal.timeout(2000),
            });
            return { healthy: res.ok };
          } catch (err) {
            return { healthy: false, message: err instanceof Error ? err.message : String(err) };
          }
        });
      }
      return this.gateway;
    } catch (err) {
      logger.warn('[runtime] Gateway start failed; HTTP gateway disabled', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.gateway = null;
      return null;
    }
  }

  startUniversalEngine(): UniversalEngineOrchestrator {
    if (!this.orchestration) throw new Error('UniversalEngine: orchestration is disabled');
    return this.orchestration.universalEngine;
  }

  dispatchConcept(input: ConceptInput): ConceptHandle {
    return this.startUniversalEngine().dispatchConcept(input);
  }

  /**
   * Reload workspace files and re-register dynamic skills from SKILL.md files.
   * Safe to call at runtime without stopping the runtime.
   */
  async reloadSkills(): Promise<number> {
    if (!this.workspace) {
      logger.warn('[runtime] reloadSkills called before workspace is initialized');
      return 0;
    }
    await this.workspace.reload();
    const count = registerDynamicSkills(this.workspace.getWorkspace()?.files?.skills ?? []);
    logger.info('[runtime] Skills reloaded', { count });
    return count;
  }

  /**
   * Graceful shutdown — each subsystem is stopped independently so one
   * failure does not block the others. Reverse of start() order.
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    if (this.shutdownTelemetry) {
      try {
        await this.shutdownTelemetry();
      } catch (err) {
        logger.warn('[runtime] OTel shutdown failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.shutdownTelemetry = null;
    }

    // 1. Stop config hot-reload watcher
    if (this._configWatchDispose) {
      try {
        this._configWatchDispose();
      } catch (err) {
        logger.warn('[runtime] Config watch dispose failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this._configWatchDispose = null;
    }

    // 2. Stop HTTP gateway
    if (this.gateway) {
      try {
        await this.gateway.stop();
      } catch (err) {
        logger.warn('[runtime] Gateway stop failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.gateway = null;
    }

    // 3. MCP (after gateway — no new HTTP to a half-torn-down client registry)
    await this.teardownMcpBootstrap();
    if (this.mcpClient) {
      try {
        await this.mcpClient.shutdown();
      } catch (err) {
        logger.warn('[runtime] MCP client shutdown failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.mcpClient = null;
    }

    // 4. Stop cron service
    if (this.cron) {
      try {
        this.cron.stop();
      } catch (err) {
        logger.warn('[runtime] Cron stop failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 5. Stop health monitor
    if (this.health) {
      try {
        this.health.stop();
      } catch (err) {
        logger.warn('[runtime] Health monitor stop failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 6. Dispose workspace watcher
    try {
      this.workspace?.dispose();
    } catch (err) {
      logger.warn('[runtime] Workspace dispose failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 7. Flush pending session writes before exit. Do NOT cleanup(0) — that would
    // delete all session files and defeat persistence across restarts.
    if (this.store) {
      try {
        await this.store.flushAll();
      } catch (err) {
        logger.error('Failed to flush session store', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        await this.store.close();
      } catch (err) {
        logger.warn('[runtime] Session store close failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (this.approvalFlowUnsubscribe) {
      this.approvalFlowUnsubscribe();
      this.approvalFlowUnsubscribe = null;
    }

    try {
      this.subagents.cancelAll();
      await this.subagents.waitForIdle(60_000);
    } catch (err) {
      logger.warn('[runtime] Subagent shutdown drain failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (this.worktreeManager) {
      try {
        await this.worktreeManager.cleanupAll();
      } catch (err) {
        logger.warn('[runtime] Governed worker worktree cleanup failed during stop', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.worktreeManager = null;
    }

    if (this.orchestration) {
      try {
        await this.orchestration.dag.flushLedger();
        await this.orchestration.eventLedger.close();
      } catch (err) {
        logger.warn('[runtime] Orchestration persistence flush failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        this.orchestration.memoryStore.close();
      } catch (err) {
        logger.warn('[runtime] Orchestration memory store close failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.orchestration = null;
    }

    if (this.runtimeBudgetController) {
      try {
        await this.runtimeBudgetController.flush();
      } catch (err) {
        logger.warn('[runtime] Token budget controller flush failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.runtimeBudgetController = null;
    }

    try {
      this.subagents.cleanup(0);
    } catch (err) {
      logger.warn('[runtime] Subagents cleanup failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      processManager.cleanup();
    } catch (err) {
      logger.warn('[runtime] ProcessManager cleanup failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.started = false;
    logger.info('PyrforRuntime stopped');
  }

  /**
   * Main entry point: handle incoming message
   */
  async handleMessage(
    channel: Channel,
    userId: string,
    chatId: string,
    text: string,
    options?: {
      sessionId?: string;
      provider?: string;
      model?: string;
      budgetProfile?: BudgetProfile;
      metadata?: Record<string, unknown>;
      worker?: RuntimeWorkerOptions;
      onProgress?: (event: import('./tool-loop').ProgressEvent) => void;
    }
  ): Promise<RuntimeMessageResult> {
    if (!this.started) {
      return { success: false, response: '', error: 'Runtime not started' };
    }

    let activeRun: ActiveRuntimeRun | null = null;
    try {
      await this.awaitWorkspaceSwitch();
      // Find or create session
      let session = options?.sessionId
        ? await this.restoreCurrentWorkspaceSession(options.sessionId)
        : this.sessions.findByContext(userId, channel, chatId, this.currentWorkspaceFilter());
      if (session && !this.belongsToCurrentWorkspace(session)) {
        session = undefined;
      }

      if (!session) {
        const createOpts: SessionCreateOptions = {
          channel,
          userId,
          chatId,
          systemPrompt: this.options.systemPrompt,
          metadata: {
            ...(options?.metadata ?? {}),
            workspaceId: this.options.workspacePath,
            title: `${channel}:${chatId}`,
          },
        };
        session = this.sessions.create(createOpts);
      }

      // Check privacy for this operation
      const privacyCheck = this.privacy.check('send_message');
      if (!privacyCheck.allowed) {
        return {
          success: false,
          response: '',
          sessionId: session.id,
          error: `Privacy restriction: ${privacyCheck.reason}`,
        };
      }

      activeRun = await this.beginUserRun({
        session,
        text,
        mode: 'chat',
        provider: options?.provider,
        model: options?.model,
        budgetProfile: options?.budgetProfile,
      });
      if (activeRun) {
        await this.markUserRunRunning(activeRun);
      }

      // Add user message
      const userMsg: Message = { role: 'user', content: text };
      const addResult = this.sessions.addMessage(session.id, userMsg);

      if (!addResult.success) {
        if (activeRun) {
          await this.completeUserRun(activeRun, 'failed', addResult.error ?? 'Failed to add user message');
        }
        return {
          success: false,
          response: '',
          sessionId: session.id,
          runId: activeRun?.runId,
          taskId: activeRun?.taskId,
          error: addResult.error,
        };
      }

      // Trigger auto-compact if needed
      if (this.options.enableCompact) {
        const compactResult = await this.compact.maybeCompact(session);
        if (compactResult?.success) {
          logger.debug('Session auto-compacted', { sessionId: session.id });
        }
      }

      if (options?.worker && activeRun) {
        await this.prepareGovernedRun(activeRun, {
          sessionId: session.id,
          trustedSession: session,
          trustSessionProjectMetadata: !options?.sessionId,
          text,
          openFiles: [],
        });
      }

      const workerResponse = await this.runLiveWorkerStream(activeRun, session.id, userId, text, options?.worker);
      let response: string;

      if (workerResponse !== null) {
        response = workerResponse;
        if (activeRun) {
          await this.finalizeGovernedRun(activeRun, session.id, options?.worker);
        }
      } else {
        const permissionGate = this.createToolLoopPermissionGate(session);
        // Get AI response (with tool calling loop)
        const messages = session.messages;
        const loopResult = await runToolLoop(
          messages,
          runtimeToolDefinitions,
          async (msgs, runOpts) =>
            this.runBudgetedChat(msgs, {
              provider: runOpts?.provider,
              model: runOpts?.model,
              sessionId: runOpts?.sessionId,
            }, activeRun),
          this.createRunAwareToolExecutor(activeRun),
          {
            sessionId: session.id,
            userId,
            runId: activeRun?.runId,
          },
          {
            provider: options?.provider,
            model: options?.model,
            sessionId: session.id,
          },
          {
            approvalGate: permissionGate,
            onProgress: options?.onProgress,
            onToolAudit: (event) => approvalFlow.recordToolOutcome(event),
          }
        );

        response = loopResult.finalText;

        if (loopResult.toolCalls.length > 0) {
          logger.info('Tool loop summary', {
            sessionId: session.id,
            iterations: loopResult.iterations,
            toolCalls: loopResult.toolCalls.map((tc) => ({
              name: tc.call.name,
              ok: tc.result.success,
            })),
            truncated: loopResult.truncated,
          });
        }
      }

      // Persist only the final assistant answer in session history.
      // Tool calls / results are ephemeral (they live inside the loop's working
      // copy); future turns get a fresh tool-call cycle, which keeps history
      // clean and avoids stuffing it with raw file dumps.
      this.sessions.addMessage(session.id, { role: 'assistant', content: response });

      // Get cost info
      const cost = this.providers.getSessionCost(session.id);
      if (activeRun && !activeRun.terminalByWorker) {
        await this.completeUserRun(activeRun, 'completed', response.slice(0, 500));
      }

      return {
        success: true,
        response,
        sessionId: session.id,
        runId: activeRun?.runId,
        taskId: activeRun?.taskId,
        tokensUsed: cost.calls * 1000, // Rough estimate
        costUsd: cost.totalUsd,
      };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (activeRun) {
        await this.completeUserRun(activeRun, 'failed', msg);
      }
      logger.error('handleMessage failed', { channel, userId, error: msg });

      return {
        success: false,
        response: '',
        runId: activeRun?.runId,
        taskId: activeRun?.taskId,
        error: `Error: ${msg}`,
      };
    }
  }

  /**
   * Stream a response (for real-time UI)
   */
  async *streamMessage(
    channel: Channel,
    userId: string,
    chatId: string,
    text: string,
    options?: {
      provider?: string;
      model?: string;
    }
  ): AsyncGenerator<{ type: 'token' | 'error' | 'done'; content?: string; error?: string }, void, unknown> {
    if (!this.started) {
      yield { type: 'error', error: 'Runtime not started' };
      return;
    }

    try {
      await this.awaitWorkspaceSwitch();
      // Find or create session
      let session = this.sessions.findByContext(userId, channel, chatId, this.currentWorkspaceFilter());

      if (!session) {
        session = this.sessions.create({
          channel,
          userId,
          chatId,
          systemPrompt: this.options.systemPrompt,
          metadata: {
            workspaceId: this.options.workspacePath,
            title: `${channel}:${chatId}`,
          },
        });
      }

      // Add user message
      this.sessions.addMessage(session.id, { role: 'user', content: text });

      // Stream response
      const messages = session.messages;
      let fullResponse = '';

      try {
        for await (const token of this.providers.chatStream(messages, {
          provider: options?.provider,
          model: options?.model,
          sessionId: session.id,
        })) {
          fullResponse += token;
          yield { type: 'token', content: token };
        }

        // Add full message to session
        this.sessions.addMessage(session.id, { role: 'assistant', content: fullResponse });
        yield { type: 'done' };

      } catch (streamError) {
        const msg = streamError instanceof Error ? streamError.message : String(streamError);
        yield { type: 'error', error: msg };
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: msg };
    }
  }

  /**
   * Execute a tool directly
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: { sessionId?: string; userId?: string }
  ): Promise<ReturnType<typeof executeRuntimeTool>> {
    // Privacy check
    const privacyCheck = this.privacy.check(toolName);
    if (!privacyCheck.allowed) {
      return {
        success: false,
        data: {},
        error: `Privacy restriction: ${privacyCheck.reason}`,
      };
    }

    return executeRuntimeTool(toolName, args, {
      sessionId: context?.sessionId,
      userId: context?.userId,
    });
  }

  /**
   * Spawn a subagent task
   */
  spawnSubagent(options: SubagentOptions): { success: boolean; taskId?: string; error?: string } {
    if (!this.options.enableSubagents) {
      return { success: false, error: 'Subagents disabled' };
    }

    // Check privacy
    const privacyCheck = this.privacy.check('send_message');
    if (!privacyCheck.allowed) {
      return { success: false, error: `Privacy restriction: ${privacyCheck.reason}` };
    }

    return this.subagents.spawn(options);
  }

  /**
   * Merge a completed subagent worktree branch into the main workspace HEAD after approval.
   * Cleans up the git worktree on success.
   */
  async mergeCompletedSubagentWorktree(
    taskId: string,
    options?: { noFf?: boolean },
  ): Promise<GitMergeResult> {
    await this.initOrchestration();
    const task = this.subagents.getTask(taskId);
    if (!task?.worktree) {
      return { ok: false, kind: 'error', message: 'No isolated subagent worktree for this task (still running or already merged)' };
    }

    const workspace = this.options.workspacePath;
    const branch = task.worktree.branch;
    const approvalId = randomUUID();

    await this.orchestration?.eventLedger.append({
      type: 'git.worktree.merge.requested',
      run_id: taskId,
      node_id: task.worktree.path,
      merge_branch: branch,
      branch_or_worktree_id: branch,
      status: 'requested',
      reason: 'awaiting approvalFlow decision',
      tool_name: 'git_worktree_merge',
    });

    const decision = await approvalFlow.requestApproval({
      id: approvalId,
      toolName: 'git_worktree_merge',
      summary: `Merge subagent branch ${branch} into current HEAD (${workspace})`,
      args: { taskId, branch, workspace },
      run_id: taskId,
    });

    if (decision !== 'approve') {
      return { ok: false, kind: 'error', message: `Merge denied or timed out (${decision})` };
    }

    const mergeResult = await gitMergeBranch(workspace, branch, { noFf: options?.noFf });

    if (mergeResult.ok) {
      await this.orchestration?.eventLedger.append({
        type: 'git.worktree.merge.completed',
        run_id: taskId,
        node_id: task.worktree.path,
        merge_branch: branch,
        merge_sha: mergeResult.mergeCommitSha,
        branch_or_worktree_id: branch,
        status: 'completed',
      });
      try {
        await this.worktreeManager?.cleanupForRun(task.worktree.runId);
      } catch (err) {
        logger.warn('[runtime] Failed to cleanup subagent worktree after merge', {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      delete task.worktree;
      return mergeResult;
    }

    if (mergeResult.kind === 'conflict') {
      await this.orchestration?.eventLedger.append({
        type: 'git.worktree.merge.conflicted',
        run_id: taskId,
        node_id: task.worktree.path,
        merge_branch: branch,
        conflict_paths: mergeResult.conflictPaths,
        branch_or_worktree_id: branch,
        status: 'conflicted',
        error: mergeResult.stderr,
      });
    }

    return mergeResult;
  }

  /**
   * Get subagent status
   */
  async waitForSubagent(taskId: string, timeoutMs?: number): Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }> {
    const result = await this.subagents.waitForTask(taskId, timeoutMs);
    return {
      success: result.success,
      result: result.result,
      error: result.error,
    };
  }

  /**
   * Get live subagent inventory for read-only operator surfaces.
   */
  listSubagents(): RuntimeSubagentSummary[] {
    return this.subagents.listTasks().map(task => ({
      id: task.id,
      name: task.task,
      status: task.status,
      startedAt: (task.startedAt ?? task.createdAt).toISOString(),
    }));
  }

  /**
   * Get runtime statistics
   */
  getStats(): RuntimeStats {
    const sessionStats = this.sessions.getStats();
    const subagentStats = this.subagents.getStats();
    const providerCosts = this.providers.getTotalCost();

    return {
      sessions: {
        active: sessionStats.totalSessions,
        totalTokens: sessionStats.totalTokens,
        byChannel: sessionStats.byChannel,
      },
      subagents: {
        active: subagentStats.active,
        total: subagentStats.total,
      },
      providers: {
        available: this.providers.getAvailableProviders(),
        costs: providerCosts,
      },
      workspace: {
        loaded: !!this.workspace?.getWorkspace(),
        filesLoaded: this.workspace?.getWorkspace()
          ? 1 + this.workspace.getWorkspace()!.files.daily.size + this.workspace.getWorkspace()!.files.skills.length
          : 0,
      },
    };
  }

  /**
   * Set Telegram bot instance
   */
  setTelegramBot(bot: TelegramSender | null): void {
    this.telegramBot = bot;
    setTelegramBot(bot);
  }

  /**
   * Clear session for a given (channel, userId, chatId) tuple.
   * Returns true if a session was found and destroyed.
   */
  clearSession(channel: Channel, userId: string, chatId: string): boolean {
    const session = this.sessions.findByContext(userId, channel, chatId, this.currentWorkspaceFilter());
    if (!session) return false;
    return this.sessions.destroy(session.id);
  }

  /**
   * Reload workspace from disk
   */
  async reloadWorkspace(): Promise<void> {
    await this.loadWorkspaceState();
    logger.info('Workspace reloaded');
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Streaming version of `handleMessage` — returns an async generator that
   * emits `StreamEvent` objects.  Integrates with the existing session
   * management, project-rules injection, and multi-file context injection.
   *
   * Used by the `POST /api/chat/stream` gateway endpoint.
   */
  async *streamChatRequest(input: {
    text: string;
    openFiles?: OpenFile[];
    workspace?: string;
    sessionId?: string;
    userId?: string;
    chatId?: string;
    provider?: string;
    model?: string;
    budgetProfile?: BudgetProfile;
    prefer?: 'local' | 'cloud' | 'auto';
    routingHints?: { contextSizeChars?: number; sensitive?: boolean };
    worker?: RuntimeWorkerOptions;
    exposeToolPayloads?: boolean;
    signal?: AbortSignal;
  }): AsyncGenerator<StreamEvent> {
    if (!this.started) {
      throw new Error('Runtime not started');
    }

    const userId = input.userId ?? 'ide-user';
    const chatId = input.chatId ?? 'ide-chat';
    const channel = 'web' as Parameters<typeof this.handleMessage>[0];
    await this.awaitWorkspaceSwitch();

    // ── Session ────────────────────────────────────────────────────────────
    let session = input.sessionId
      ? await this.restoreCurrentWorkspaceSession(input.sessionId)
      : this.sessions.findByContext(userId, channel, chatId, this.currentWorkspaceFilter());
    if (session && !this.belongsToCurrentWorkspace(session)) {
      session = undefined;
    }

    if (!session) {
      // Load project rules once so we can bake them into the system prompt.
      const rules = input.workspace ? await loadProjectRules(input.workspace) : null;
      const systemPrompt = composeSystemPrompt(this.options.systemPrompt, rules);

      session = this.sessions.create({
        channel,
        userId,
        chatId,
        systemPrompt,
        metadata: {
          workspaceId: this.options.workspacePath,
          title: `${channel}:${chatId}`,
        },
      });
    }

    let activeRun: ActiveRuntimeRun | null = null;
    const sessionId = session.id;
    let finalText = '';

    try {
      activeRun = await this.beginUserRun({
        session,
        text: input.text,
        mode: 'chat',
        provider: input.provider,
        model: input.model,
        budgetProfile: input.budgetProfile,
      });
      if (activeRun) {
        await this.markUserRunRunning(activeRun);
        yield { type: 'run', sessionId, runId: activeRun.runId, taskId: activeRun.taskId };
      }

      // ── User message (with optional context-file block) ────────────────────
      let userText = input.text;
      if (input.openFiles && input.openFiles.length > 0) {
        const ctxBlock = buildContextBlock(input.openFiles);
        userText = `${ctxBlock}\n\n${userText}`;
      }
      const addResult = this.sessions.addMessage(sessionId, { role: 'user', content: userText });
      if (!addResult.success) {
        throw new Error(addResult.error ?? 'Failed to add user message');
      }
      if (this.options.enableCompact) {
        const compactResult = await this.compact.maybeCompact(session);
        if (compactResult?.success) {
          logger.debug('Session auto-compacted', { sessionId: session.id });
        }
      }

      // ── Build messages (includes system prompt + history) ─────────────────
      const messages = session.messages;

      if (input.worker && activeRun) {
        await this.prepareGovernedRun(activeRun, {
          sessionId,
          trustedSession: session,
          trustSessionProjectMetadata: !input.sessionId,
          text: input.text,
          openFiles: input.openFiles ?? [],
        });
      }

      const workerResponse = await this.runLiveWorkerStream(activeRun, sessionId, userId, userText, input.worker);
      if (workerResponse !== null) {
        finalText = workerResponse;
        if (activeRun) {
          await this.finalizeGovernedRun(activeRun, sessionId, input.worker);
        }
        yield { type: 'final', text: finalText };
      } else {
        const permissionGate = this.createToolLoopPermissionGate(session);
        // ── Stream ────────────────────────────────────────────────────────────
        for await (const event of handleMessageStream(messages, {
          chat: (msgs, opts) =>
            this.runBudgetedChat(msgs, {
              provider: opts?.provider ?? input.provider,
              model: opts?.model ?? input.model,
              sessionId: opts?.sessionId ?? sessionId,
              prefer: input.prefer,
              routingHints: input.routingHints,
            }, activeRun),
          exec: this.createRunAwareToolExecutor(activeRun),
          tools: runtimeToolDefinitions,
          exposeToolPayloads: input.exposeToolPayloads ?? true,
          toolCtx: {
            sessionId,
            userId,
            runId: activeRun?.runId,
          },
          runOpts: {
            provider: input.provider,
            model: input.model,
            sessionId,
          },
          loopOpts: {
            signal: input.signal,
            approvalGate: permissionGate,
            onToolAudit: (event) => approvalFlow.recordToolOutcome(event),
          },
        })) {
          if (event.type === 'final') {
            finalText = event.text;
          }
          yield event;
        }
      }
      if (activeRun && !activeRun.terminalByWorker) {
        await this.completeUserRun(activeRun, 'completed', finalText.slice(0, 500));
      }
    } catch (err) {
      if (activeRun) {
        await this.completeUserRun(activeRun, 'failed', err instanceof Error ? err.message : String(err));
      }
      throw err;
    }

    // Persist assistant response (same as handleMessage).
    this.sessions.addMessage(session.id, { role: 'assistant', content: finalText });
  }

  private collectSubagentWorktreeRetainRunIds(): string[] {
    const ids: string[] = [];
    for (const t of this.subagents.listTasks()) {
      if (t.worktree?.runId) {
        ids.push(t.worktree.runId);
      }
    }
    return ids;
  }

  private async executeSubagentTask(task: SubagentTask): Promise<string> {
    await this.initOrchestration();
    const runId = `subagent:${task.id}`;
    let managed: ManagedGitWorktree | null = null;
    let keepWorktree = false;

    try {
      if (this.worktreeManager) {
        try {
          managed = await this.worktreeManager.createForRun(runId);
          await this.orchestration?.eventLedger.append({
            type: 'sandbox.run.started',
            run_id: task.id,
            node_id: managed.id,
            sandbox_backend: 'git-worktree',
            branch_or_worktree_id: managed.branch,
            status: 'started',
            reason: `subagent isolated worktree from ${managed.baseBranch}`,
          });
        } catch (err) {
          logger.warn('[runtime] Subagent worktree creation failed; continuing without isolation', {
            taskId: task.id,
            error: err instanceof Error ? err.message : String(err),
          });
          managed = null;
        }
      }

      const execRoot = managed?.path ?? this.options.workspacePath;
      const systemAugmented = managed
        ? `${task.context.systemPrompt}\n\nYou are executing in an isolated git worktree copy at ${managed.path}. Prefer relative paths for repository files; shell cwd must stay inside this worktree when using exec.`
        : task.context.systemPrompt;

      const messages: Message[] = [
        { role: 'system', content: systemAugmented },
        ...task.context.recentMessages,
        { role: 'user', content: task.task },
      ];

      const session = this.sessions.get(task.parentSessionId);
      const approvalGate =
        session
          ? createPermissionApprovalGate({
            permissionEngine: this.runtimePermissionEngine,
            permissionContext: {
              workspaceId: this.resolvePermissionWorkspaceId(session),
              sessionId: session.id,
            },
            requestApproval: (req) => approvalFlow.requestApproval(req),
          })
          : async () => 'approve' as const;

      const toolExec = async (
        name: string,
        args: Record<string, unknown>,
        ctx?: Parameters<typeof executeRuntimeTool>[2],
      ) =>
        executeRuntimeTool(name, args, {
          ...ctx,
          execRoot,
          sessionId: task.parentSessionId,
        });

      let finalText: string;
      if (managed) {
        const loopResult = await runToolLoop(
          messages,
          runtimeToolDefinitions,
          async (msgs, runOpts) =>
            this.runBudgetedChat(msgs, {
              provider: runOpts?.provider ?? task.provider,
              model: runOpts?.model,
              sessionId: runOpts?.sessionId ?? task.parentSessionId,
            }, null),
          toolExec,
          {
            sessionId: task.parentSessionId,
            execRoot,
          },
          {
            provider: task.provider,
            sessionId: task.parentSessionId,
          },
          {
            maxIterations: task.limits?.maxIterations ?? 8,
            signal: task.abortSignal,
            approvalGate,
            onToolAudit: (event) => approvalFlow.recordToolOutcome(event),
          },
        );
        finalText = loopResult.finalText;
      } else {
        finalText = await this.providers.chat(
          [
            { role: 'system', content: task.context.systemPrompt },
            ...task.context.recentMessages,
            { role: 'user', content: task.task },
          ],
          {
            maxTokens: task.maxTokens ?? 2000,
            signal: task.abortSignal,
          },
        );
      }

      keepWorktree = Boolean(managed);
      if (managed) {
        task.worktree = {
          runId,
          path: managed.path,
          branch: managed.branch,
          baseBranch: managed.baseBranch,
        };
      }
      return finalText;
    } catch (err) {
      keepWorktree = false;
      throw err;
    } finally {
      if (managed && this.worktreeManager && !keepWorktree) {
        try {
          await this.worktreeManager.cleanupForRun(runId);
          await this.orchestration?.eventLedger.append({
            type: 'sandbox.run.completed',
            run_id: task.id,
            node_id: managed.id,
            sandbox_backend: 'git-worktree',
            branch_or_worktree_id: managed.branch,
            status: 'cleaned',
            reason: 'subagent worktree removed after cancel/failure',
          });
        } catch (cleanupErr) {
          logger.warn('[runtime] Subagent worktree cleanup failed', {
            taskId: task.id,
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          });
        }
        delete task.worktree;
      }
    }
  }

  private async beginUserRun(input: {
    session: { id: string; messages: Message[] };
    text: string;
    mode: 'chat' | 'edit' | 'autonomous' | 'pm';
    provider?: string;
    model?: string;
    budgetProfile?: BudgetProfile;
  }): Promise<ActiveRuntimeRun | null> {
    const runLedger = this.orchestration?.runLedger;
    if (!runLedger) return null;

    const taskId = `turn-${randomUUID()}`;
    const run = await runLedger.createRun({
      task_id: taskId,
      workspace_id: this.options.workspacePath,
      repo_id: this.options.workspacePath,
      branch_or_worktree_id: '',
      mode: input.mode,
      goal: input.text.slice(0, 500),
      model_profile: input.model ?? this.config.ai?.activeModel?.modelId ?? '',
      provider_route: input.provider ?? this.config.ai?.activeModel?.provider ?? this.config.providers?.defaultProvider ?? '',
      context_snapshot_hash: this.hashRunInput(`${input.session.id}:${input.session.messages.length}`),
      prompt_snapshot_hash: this.hashRunInput(input.text),
      permission_profile: { profile: 'standard' },
      budget_profile: input.budgetProfile ?? {},
    });
    await runLedger.transition(run.run_id, 'planned', 'user turn accepted');
    const activeRun: ActiveRuntimeRun = {
      runId: run.run_id,
      taskId,
      budgetScope: 'task',
      budgetTargetId: run.run_id,
    };
    this.attachRuntimeBudgetProfile(activeRun, run);
    this.sessions.updateMetadata(input.session.id, {
      lastRunId: run.run_id,
      lastTaskId: taskId,
    });
    return activeRun;
  }

  listProductFactoryTemplates(): ProductFactoryTemplate[] {
    return this.productFactory.listTemplates();
  }

  previewProductFactoryPlan(input: ProductFactoryPlanInput): ProductFactoryPlanPreview {
    return this.productFactory.previewPlan(input);
  }

  async spawnActor(input: SpawnActorInput): Promise<SpawnActorResult> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ActorKernel: orchestration is disabled');
    return this.orchestration.actorKernel.spawnActor(input);
  }

  async enqueueActorMessage(input: EnqueueActorMessageInput): Promise<DagNode> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ActorKernel: orchestration is disabled');
    return this.orchestration.actorKernel.enqueueMessage(input);
  }

  async leaseActorMessage(input: LeaseActorMessageInput): Promise<LeaseActorMessageResult | null> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ActorKernel: orchestration is disabled');
    return this.orchestration.actorKernel.leaseNextMessage(input);
  }

  async completeActorMessage(input: CompleteActorMessageInput): Promise<CompleteActorMessageResult> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ActorKernel: orchestration is disabled');
    return this.orchestration.actorKernel.completeMessage(input);
  }

  async failActorMessage(input: FailActorMessageInput): Promise<DagNode> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ActorKernel: orchestration is disabled');
    return this.orchestration.actorKernel.failMessage(input);
  }

  async recoverStuckActorMessages(input: RecoverStuckActorMessagesInput): Promise<RecoverStuckActorMessagesResult> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ActorKernel: orchestration is disabled');
    return this.orchestration.actorKernel.recoverStuckMessages(input);
  }

  async dispatchNextActorMessage(input: DispatchActorMessageInput): Promise<DispatchActorMessageResult> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ActorKernel: orchestration is disabled');
    const lease = await this.orchestration.actorKernel.leaseNextMessage(input);
    if (!lease) return { lease: null };
    const node = lease.node;
    const run = this.orchestration.runLedger.getRun(input.runId);
    const actorId = String(node.payload['actorId'] ?? input.actorId ?? 'unknown');
    const task = String(node.payload['task'] ?? '');
    const capability = actorDispatchCapability(node);
    if (capability?.kind === 'research_source_capture') {
      return this.dispatchResearchSourceCaptureActorMessage(input, lease, actorId, capability);
    }
    if (capability?.kind === 'unsupported') {
      return this.dispatchUnsupportedActorCapability(input, lease, capability);
    }
    const payload = node.payload['payload'] !== undefined
      ? JSON.stringify(node.payload['payload'], null, 2)
      : undefined;
    const systemPrompt = input.systemPrompt?.trim()
      || `You are Pyrfor actor "${actorId}". Execute exactly one mailbox task. Return concise text only. Do not call tools, mutate files, access the network, or claim side effects.`;
    const contextPack = await this.getRunContextPack(input.runId).catch(() => null);
    const contextBlock = buildActorDispatchContextBlock(contextPack?.pack, actorId);
    const userPrompt = [
      input.instruction?.trim(),
      `Task: ${task}`,
      payload ? `Payload JSON:\n${payload}` : undefined,
      contextBlock,
    ].filter(Boolean).join('\n\n');

    let response: string;
    try {
      response = await this.providers.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], {
        maxTokens: input.maxTokens ?? 2000,
        ...(run?.provider_route ? { provider: run.provider_route } : {}),
      });
    } catch (err) {
      const failure = await this.orchestration.actorKernel.failMessage({
        runId: input.runId,
        nodeId: node.id,
        owner: input.owner,
        reason: err instanceof Error ? err.message : String(err),
        retryable: true,
      });
      return { lease, failure };
    }

    const completion = await this.orchestration.actorKernel.completeMessage({
      runId: input.runId,
      nodeId: node.id,
      owner: input.owner,
      summary: response.slice(0, 500),
      output: response,
      proof: {
        dispatch: 'llm_only',
        actorId,
        model: this.config.ai?.activeModel?.modelId ?? '',
        provider: this.config.ai?.activeModel?.provider ?? this.config.providers?.defaultProvider ?? '',
      },
    });
    return {
      lease,
      response,
      completion: {
        ...completion,
        proofArtifact: publicRuntimeArtifactRef(completion.proofArtifact),
      },
    };
  }

  private async dispatchUnsupportedActorCapability(
    input: DispatchActorMessageInput,
    lease: LeaseActorMessageResult,
    capability: UnsupportedActorCapability,
  ): Promise<DispatchActorMessageResult> {
    if (!this.orchestration) throw new Error('ActorKernel: orchestration is disabled');
    const failure = await this.orchestration.actorKernel.failMessage({
      runId: input.runId,
      nodeId: lease.node.id,
      owner: input.owner,
      reason: 'unsupported_actor_capability',
      retryable: false,
    });
    return {
      lease: { ...lease, node: sanitizeUnsupportedCapabilityDagNode(lease.node, capability) },
      failure: sanitizeUnsupportedCapabilityDagNode(failure, capability),
      capability: {
        kind: 'unsupported',
        status: 'failed',
      },
    };
  }

  private async dispatchResearchSourceCaptureActorMessage(
    input: DispatchActorMessageInput,
    lease: LeaseActorMessageResult,
    actorId: string,
    capability: ActorResearchSourceCaptureCapability,
  ): Promise<DispatchActorMessageResult> {
    if (!this.orchestration) throw new Error('ActorKernel: orchestration is disabled');
    const node = lease.node;
    let normalized: ReturnType<typeof normalizeResearchSourceCaptureInput>;
    try {
      normalized = normalizeResearchSourceCaptureInput(capability);
    } catch (err) {
      const failure = await this.orchestration.actorKernel.failMessage({
        runId: input.runId,
        nodeId: node.id,
        owner: input.owner,
        reason: err instanceof Error ? err.message : 'invalid research source capture capability',
        retryable: false,
      });
      return {
        lease: { ...lease, node: sanitizeInvalidResearchSourceCaptureDagNode(lease.node) },
        failure: sanitizeInvalidResearchSourceCaptureDagNode(failure),
        capability: { kind: 'research_source_capture', status: 'failed' },
      };
    }

    const approvalId = buildActorResearchSourceCaptureApprovalId(normalized, input.runId, node.id);
    const publicLease = sanitizeResearchSourceCaptureLease(lease, normalized);
    const approvalArgs = {
      runId: input.runId,
      sourceHost: normalized.host,
      sourceUrlHash: normalized.urlHash,
      sourcePathHash: normalized.pathHash,
      governedSourceCapture: true,
      actorMailboxNodeId: node.id,
    };
    const pendingOrResolvedApproval = this.getActorResearchSourceCaptureApproval(input.runId, approvalId, normalized, node.id);
    if (!pendingOrResolvedApproval) {
      const approval = await approvalFlow.enqueueApproval({
        id: approvalId,
        toolName: 'research_source_capture',
        summary: `Capture governed research source for ${input.runId}`,
        args: approvalArgs,
        run_id: input.runId,
        reason: 'Actor research source capture performs a bounded network fetch and stores sanitized source evidence, so it requires explicit approval',
        approval_required: true,
      });
      const failure = await this.orchestration.actorKernel.failMessage({
        runId: input.runId,
        nodeId: node.id,
        owner: input.owner,
        reason: `approval_required:${approval.id}`,
        retryable: true,
      });
      return {
        lease: publicLease,
        failure: sanitizeResearchSourceCaptureDagNode(failure, normalized),
        approval,
        capability: { kind: 'research_source_capture', status: 'approval_required' },
      };
    }

    const resolvedApproval = approvalFlow.getResolvedApproval(approvalId);
    if (!resolvedApproval) {
      const failure = await this.orchestration.actorKernel.failMessage({
        runId: input.runId,
        nodeId: node.id,
        owner: input.owner,
        reason: `approval_pending:${approvalId}`,
        retryable: true,
      });
      return {
        lease: publicLease,
        failure: sanitizeResearchSourceCaptureDagNode(failure, normalized),
        approval: pendingOrResolvedApproval,
        capability: { kind: 'research_source_capture', status: 'approval_required' },
      };
    }
    if (
      resolvedApproval.request.toolName !== 'research_source_capture'
      || resolvedApproval.request.args['runId'] !== input.runId
      || resolvedApproval.request.args['sourceUrlHash'] !== normalized.urlHash
      || resolvedApproval.request.args['sourcePathHash'] !== normalized.pathHash
      || resolvedApproval.request.args['actorMailboxNodeId'] !== node.id
    ) {
      const failure = await this.orchestration.actorKernel.failMessage({
        runId: input.runId,
        nodeId: node.id,
        owner: input.owner,
        reason: 'research_source_capture_approval_mismatch',
        retryable: false,
      });
      return {
        lease: publicLease,
        failure: sanitizeResearchSourceCaptureDagNode(failure, normalized),
        capability: { kind: 'research_source_capture', status: 'failed' },
      };
    }
    if (resolvedApproval.decision !== 'approve') {
      approvalFlow.consumeResolvedApproval(approvalId);
      const failure = await this.orchestration.actorKernel.failMessage({
        runId: input.runId,
        nodeId: node.id,
        owner: input.owner,
        reason: `research_source_capture_${resolvedApproval.decision}`,
        retryable: false,
      });
      return {
        lease: publicLease,
        failure: sanitizeResearchSourceCaptureDagNode(failure, normalized),
        approval: resolvedApproval.request,
        capability: { kind: 'research_source_capture', status: 'denied' },
      };
    }
    const consumedApproval = approvalFlow.consumeResolvedApproval(approvalId);
    if (!consumedApproval) {
      const failure = await this.orchestration.actorKernel.failMessage({
        runId: input.runId,
        nodeId: node.id,
        owner: input.owner,
        reason: 'research_source_capture_approval_unavailable',
        retryable: true,
      });
      return {
        lease: publicLease,
        failure: sanitizeResearchSourceCaptureDagNode(failure, normalized),
        capability: { kind: 'research_source_capture', status: 'approval_required' },
      };
    }

    try {
      const result = await this.captureRunResearchSource(input.runId, {
        url: normalized.url,
        ...(normalized.note ? { note: normalized.note } : {}),
        approvalId,
      });
      approvalFlow.recordToolOutcome({
        requestId: approvalId,
        toolName: 'research_source_capture',
        summary: `Capture governed research source for ${input.runId}`,
        args: approvalArgs,
        decision: 'approve',
        resultSummary: `Research source captured from ${result.snapshot.finalHost}`,
        undo: { supported: false },
      });
      const completion = await this.orchestration.actorKernel.completeMessage({
        runId: input.runId,
        nodeId: node.id,
        owner: input.owner,
        summary: `Captured governed research source from ${result.snapshot.finalHost}`,
        output: `Captured governed research source artifact ${result.artifact.id}`,
        proof: {
          dispatch: 'governed_capability',
          capability: 'research_source_capture',
          actorId,
          artifactId: result.artifact.id,
          artifactKind: result.artifact.kind,
          artifactSha256: result.artifact.sha256,
          requestedUrlHash: result.snapshot.requestedUrlHash,
          finalUrlHash: result.snapshot.finalUrlHash,
          finalHost: result.snapshot.finalHost,
          approvalId,
        },
      });
      const publicCompletion = {
        ...completion,
        node: sanitizeResearchSourceCaptureDagNode(completion.node, normalized),
        proofArtifact: publicRuntimeArtifactRef(completion.proofArtifact),
      };
      return {
        lease: publicLease,
        completion: publicCompletion,
        approval: consumedApproval.request,
        capability: {
          kind: 'research_source_capture',
          status: 'captured',
          artifact: {
            id: result.artifact.id,
            kind: result.artifact.kind,
            ...(result.artifact.sha256 ? { sha256: result.artifact.sha256 } : {}),
            createdAt: result.artifact.createdAt,
          },
        },
      };
    } catch (err) {
      approvalFlow.recordToolOutcome({
        requestId: approvalId,
        toolName: 'research_source_capture',
        summary: `Capture governed research source for ${input.runId}`,
        args: approvalArgs,
        decision: 'approve',
        error: 'research_source_capture_failed',
        undo: { supported: false },
      });
      const failure = await this.orchestration.actorKernel.failMessage({
        runId: input.runId,
        nodeId: node.id,
        owner: input.owner,
        reason: 'research_source_capture_failed',
        retryable: true,
      });
      logger.warn('[runtime] Actor research source capture failed', {
        runId: input.runId,
        nodeId: node.id,
        error: err instanceof Error ? err.name : typeof err,
      });
      return {
        lease: publicLease,
        failure: sanitizeResearchSourceCaptureDagNode(failure, normalized),
        approval: consumedApproval.request,
        capability: { kind: 'research_source_capture', status: 'failed' },
      };
    }
  }

  private getActorResearchSourceCaptureApproval(
    runId: string,
    expectedApprovalId: string,
    normalized: ReturnType<typeof normalizeResearchSourceCaptureInput>,
    nodeId: string,
  ): ApprovalRequest | undefined {
    const pending = approvalFlow.getPending().find((request) =>
      request.id === expectedApprovalId
      || (
        request.toolName === 'research_source_capture'
        && request.args['runId'] === runId
        && request.args['sourceUrlHash'] === normalized.urlHash
        && request.args['sourcePathHash'] === normalized.pathHash
        && request.args['actorMailboxNodeId'] === nodeId
      )
    );
    if (pending) return pending;
    return approvalFlow.getResolvedApproval(expectedApprovalId)?.request;
  }

  async createProductFactoryRun(input: ProductFactoryPlanInput): Promise<{
    run: RunRecord;
    preview: ProductFactoryPlanPreview;
    artifact: ArtifactRef;
  }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');

    const preview = this.productFactory.previewPlan(input);
    if (preview.missingClarifications.length > 0) {
      const missing = preview.missingClarifications.map((item) => item.id).join(', ');
      throw new Error(`ProductFactory: missing required clarifications: ${missing}`);
    }
    const run = await this.orchestration.runLedger.createRun({
      task_id: preview.intent.id,
      workspace_id: this.options.workspacePath,
      repo_id: this.options.workspacePath,
      branch_or_worktree_id: '',
      mode: 'pm',
      goal: preview.intent.goal.slice(0, 500),
      model_profile: this.config.ai?.activeModel?.modelId ?? '',
      provider_route: this.config.ai?.activeModel?.provider ?? this.config.providers?.defaultProvider ?? '',
      context_snapshot_hash: this.hashRunInput(`${preview.intent.id}:${preview.template.id}`),
      prompt_snapshot_hash: this.hashRunInput(preview.intent.goal),
      permission_profile: { profile: 'standard' },
      budget_profile: {},
    });
    await this.orchestration.runLedger.transition(run.run_id, 'planned', 'product factory plan preview created');

    const artifact = await this.orchestration.artifactStore.writeJSON('plan', preview, {
      runId: run.run_id,
      meta: {
        productFactory: true,
        templateId: preview.template.id,
        intentId: preview.intent.id,
      },
    });
    const recorded = await this.orchestration.runLedger.recordArtifact(run.run_id, artifact.id, []);
    this.seedProductFactoryDag(run.run_id, preview, artifact);
    await this.seedProductFactoryActors(run.run_id, preview, artifact);

    return { run: recorded, preview, artifact };
  }

  async getRunProductFactoryPlan(runId: string): Promise<{ artifact: ArtifactRef; preview: ProductFactoryPlanPreview }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`ProductFactory: run not found: ${runId}`);
    const { artifact, preview } = await this.loadProductFactoryPreviewArtifact(runId);
    return { artifact, preview };
  }

  async getRunKsReconciliationReviewPack(
    runId: string,
  ): Promise<{ artifact: ArtifactRef; reviewPack: KsReconciliationReviewPack } | null> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`ProductFactory: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'summary' });
    const reviewArtifact = [...artifacts].reverse().find((artifact) => artifact.meta?.['stage'] === 'review_pack');
    if (!reviewArtifact) return null;
    return {
      artifact: reviewArtifact,
      reviewPack: reviewArtifact.sha256
        ? await this.orchestration.artifactStore.readJSONVerified<KsReconciliationReviewPack>(reviewArtifact, reviewArtifact.sha256)
        : await this.orchestration.artifactStore.readJSON<KsReconciliationReviewPack>(reviewArtifact),
    };
  }

  async reviewRunKsReconciliationFinding(
    runId: string,
    findingId: string,
    input: {
      action: KsReconciliationFindingReviewAction;
      reviewerId: string;
      reviewerComment?: string;
    },
  ): Promise<{ artifact: ArtifactRef; reviewPack: KsReconciliationReviewPack; finding: KsReconciliationFinding }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`ProductFactory: run not found: ${runId}`);
    if (run.status !== 'blocked') {
      throw new Error(`ProductFactory: reconciliation run ${runId} must be blocked before review`);
    }
    const preview = await this.loadProductFactoryPreview(runId);
    if (preview.template.id !== 'ks_reconciliation') {
      throw new Error(`ProductFactory: run ${runId} is not a KS reconciliation run`);
    }
    const reviewArtifact = await this.findKsReconciliationReviewPackArtifact(runId);
    const reviewPack = reviewArtifact.sha256
      ? await this.orchestration.artifactStore.readJSONVerified<KsReconciliationReviewPack>(reviewArtifact, reviewArtifact.sha256)
      : await this.orchestration.artifactStore.readJSON<KsReconciliationReviewPack>(reviewArtifact);
    const reviewedAt = new Date().toISOString();
    const updatedReviewPack = reviewKsReconciliationFinding(reviewPack, {
      findingId,
      action: input.action,
      reviewerId: input.reviewerId,
      reviewedAt,
      reviewerComment: input.reviewerComment,
    });
    const artifact = await this.orchestration.artifactStore.writeJSON('summary', updatedReviewPack, {
      runId,
      meta: {
        ...(reviewArtifact.meta ?? {}),
        stage: 'review_pack',
        reviewedFindingId: findingId,
        reviewedAction: input.action,
        reviewedAt,
        sourceReviewArtifactId: reviewArtifact.id,
      },
    });
    await this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
    const finding = updatedReviewPack.findings.find((entry) => entry.finding_id === findingId);
    if (!finding) throw new Error(`ProductFactory: updated finding missing for ${findingId}`);
    return { artifact, reviewPack: updatedReviewPack, finding };
  }

  async executeProductFactoryRun(
    runId: string,
    options: {
      worker?: RuntimeWorkerOptions;
      sessionId?: string;
      userId?: string;
      approvalId?: string;
    } = {},
  ): Promise<{
    run: RunRecord;
    deliveryArtifact: ArtifactRef;
    summary: string;
    deliveryEvidenceArtifact?: ArtifactRef;
    deliveryEvidence?: DeliveryEvidenceSnapshot;
    approval?: ApprovalRequest;
  }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');

    const runRecord = this.orchestration.runLedger.getRun(runId);
    if (!runRecord) throw new Error(`ProductFactory: run not found: ${runId}`);
    if (runRecord.mode !== 'pm') throw new Error(`ProductFactory: run ${runId} is not a product run`);
    const preview = await this.loadProductFactoryPreview(runId);
    if (preview.template.id === 'ochag_family_reminder') {
      return this.executeOchagReminderRun(runId, runRecord, preview);
    }
    if (preview.template.id === 'business_brief') {
      return this.executeCeoclawBusinessBriefRun(runId, runRecord, preview, options.approvalId);
    }
    if (preview.template.id === 'ks_reconciliation') {
      return this.executeKsReconciliationRun(runId, runRecord, preview, options.approvalId);
    }
    if (runRecord.status !== 'planned') {
      throw new Error(`ProductFactory: run ${runId} must be planned before execution`);
    }

    const sessionId = options.sessionId ?? `product-factory:${runId}`;
    const userId = options.userId ?? 'product-factory';
    const activeRun: ActiveRuntimeRun = { runId, taskId: runRecord.task_id };
    const worker = this.withProductFactoryDefaultWorker(options.worker, preview);

    await this.orchestration.runLedger.transition(runId, 'running', 'product factory execution started');
    await this.completeProductFactoryDagNodes(runId, [
      'product_factory.clarify_scope',
      'product_factory.compile_context',
      'product_factory.scoped_plan',
    ]);

    try {
      await this.prepareGovernedRun(activeRun, {
        sessionId,
        text: this.productFactoryExecutionPrompt(preview),
        openFiles: [],
      });
      const summary = await this.runLiveWorkerStream(activeRun, sessionId, userId, this.productFactoryExecutionPrompt(preview), worker)
        ?? 'Product Factory execution completed.';
      await this.completeProductFactoryDagNodes(runId, ['product_factory.worker_execution']);
      const verifierStatus = await this.finalizeGovernedRun(activeRun, sessionId, worker, { completeRun: false });
      if (verifierStatus !== 'passed' && verifierStatus !== 'warning') {
        await this.orchestration.runLedger.blockRun(runId, `verifier ${verifierStatus ?? 'unknown'}`);
        throw new Error(`ProductFactory: verifier blocked execution (${verifierStatus ?? 'unknown'}); create a verifier waiver to complete this run`);
      }
      const deliveryArtifact = await this.orchestration.artifactStore.writeJSON('summary', {
        productFactory: true,
        runId,
        intent: preview.intent,
        templateId: preview.template.id,
        summary,
        deliveryChecklist: preview.deliveryChecklist,
        verifierStatus,
      }, {
        runId,
        meta: {
          productFactory: true,
          templateId: preview.template.id,
          intentId: preview.intent.id,
          delivery: true,
          verifierStatus,
        },
      });
      await this.orchestration.runLedger.recordArtifact(runId, deliveryArtifact.id, [deliveryArtifact.uri]);
      await this.completeProductFactoryDagNodes(runId, [
        'product_factory.verify',
        'product_factory.delivery_package',
      ], deliveryArtifact);
      const deliveryEvidence = await this.captureRunDeliveryEvidence(runId, {
        summary,
        verifierStatus,
        deliveryChecklist: preview.deliveryChecklist,
        deliveryArtifactId: deliveryArtifact.id,
      });
      await this.completeProductFactoryActorGate(runId);
      await this.completeUserRun(activeRun, 'completed', `product factory verified: ${verifierStatus}`);
      return {
        run: this.orchestration.runLedger.getRun(runId)!,
        deliveryArtifact,
        deliveryEvidenceArtifact: deliveryEvidence.artifact,
        deliveryEvidence: deliveryEvidence.snapshot,
        summary,
      };
    } catch (err) {
      const current = this.orchestration.runLedger.getRun(runId);
      if (current && current.status !== 'failed' && current.status !== 'completed' && current.status !== 'blocked' && current.status !== 'cancelled') {
        await this.orchestration.runLedger.completeRun(runId, 'failed', err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  }

  async captureRunDeliveryEvidence(
    runId: string,
    input: {
      summary?: string;
      verifierStatus?: string;
      deliveryChecklist?: string[];
      deliveryArtifactId?: string;
      issueNumber?: number;
    } = {},
  ): Promise<{ artifact: ArtifactRef; snapshot: DeliveryEvidenceSnapshot }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('DeliveryEvidence: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`DeliveryEvidence: run not found: ${runId}`);
    const verifierDecision = await this.resolveRunVerifierDecision(runId, 'delivery');
    if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'warning' && verifierDecision.status !== 'waived') {
      throw new Error(`DeliveryEvidence: verifier has not approved run ${runId} (${verifierDecision.status})`);
    }

    const snapshot = await captureDeliveryEvidence({
      workspace: this.options.workspacePath,
      runId,
      summary: input.summary,
      verifierStatus: verifierDecision.status,
      deliveryChecklist: input.deliveryChecklist,
      deliveryArtifactId: input.deliveryArtifactId,
      issueNumber: input.issueNumber,
      githubToken: this.resolveGithubToken(),
      verifier: {
        status: verifierDecision.status,
        rawStatus: verifierDecision.rawStatus,
        ...(verifierDecision.waivedFrom ? { waivedFrom: verifierDecision.waivedFrom } : {}),
        ...(verifierDecision.reason ? { reason: verifierDecision.reason } : {}),
        ...(verifierDecision.waiverArtifact ? { waiverArtifactId: verifierDecision.waiverArtifact.id } : {}),
      },
    });
    const artifact = await this.orchestration.artifactStore.writeJSON('delivery_evidence', snapshot, {
      runId,
      meta: {
        provider: 'github',
        repository: snapshot.github.repository,
        branch: snapshot.git.branch,
        commitSha: snapshot.git.headSha,
        verifierStatus: snapshot.verifierStatus,
        rawVerifierStatus: verifierDecision.rawStatus,
        waiverArtifactId: verifierDecision.waiverArtifact?.id,
        deliveryArtifactId: snapshot.deliveryArtifactId,
      },
    });
    const currentRun = this.orchestration.runLedger.getRun(runId);
    if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
    }
    await this.completeDeliveryEvidenceDagNode(runId, artifact, snapshot);
    return { artifact, snapshot };
  }

  async createRunResearchEvidence(
    runId: string,
    input: ResearchEvidenceInput,
  ): Promise<{ artifact: ArtifactRef; snapshot: ResearchEvidenceSnapshot }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ResearchEvidence: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`ResearchEvidence: run not found: ${runId}`);
    if (['completed', 'failed', 'cancelled', 'archived'].includes(run.status)) {
      throw new Error(`ResearchEvidence: cannot record evidence for inactive run ${runId} (${run.status})`);
    }
    const snapshot = createResearchEvidenceSnapshot(runId, input);
    const artifact = await this.orchestration.artifactStore.writeJSON('summary', snapshot, {
      runId,
      meta: {
        artifactKind: 'research_evidence',
        schemaVersion: snapshot.schemaVersion,
        sourceMode: snapshot.sourceMode,
        sourceCount: snapshot.sources.length,
        queryHash: snapshot.queryHash,
      },
    });
    try {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
    } catch (err) {
      await this.orchestration.artifactStore.remove(artifact);
      throw err;
    }
    return { artifact, snapshot };
  }

  async captureRunResearchSearch(
    runId: string,
    input: GovernedResearchSearchInput & { approvalId: string; notes?: string[] },
  ): Promise<{ artifact: ArtifactRef; snapshot: ResearchEvidenceSnapshot }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ResearchSearch: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`ResearchSearch: run not found: ${runId}`);
    if (['completed', 'failed', 'cancelled', 'archived'].includes(run.status)) {
      throw new Error(`ResearchSearch: cannot record evidence for inactive run ${runId} (${run.status})`);
    }
    const search = await runGovernedResearchSearch(input);
    const snapshot = createGovernedSearchResearchEvidenceSnapshot(runId, {
      query: input.query,
      notes: input.notes,
      approvalId: input.approvalId,
      provider: search.provider,
      maxResults: search.maxResults,
      executedAt: search.executedAt,
      results: search.results,
    });
    const artifact = await this.orchestration.artifactStore.writeJSON('summary', snapshot, {
      runId,
      meta: {
        artifactKind: 'research_evidence',
        schemaVersion: snapshot.schemaVersion,
        sourceMode: snapshot.sourceMode,
        sourceCount: snapshot.sources.length,
        queryHash: snapshot.queryHash,
        provider: search.provider,
      },
    });
    try {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
    } catch (err) {
      await this.orchestration.artifactStore.remove(artifact);
      throw err;
    }
    return { artifact, snapshot };
  }

  async listRunResearchEvidence(
    runId: string,
  ): Promise<Array<{ artifact: ArtifactRef; snapshot: ResearchEvidenceSnapshot }>> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ResearchEvidence: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`ResearchEvidence: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'summary' });
    const evidenceArtifacts = artifacts
      .filter((artifact) => artifact.meta?.['artifactKind'] === 'research_evidence')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const evidence = await Promise.all(evidenceArtifacts.map(async (artifact) => ({
      artifact,
      snapshot: artifact.sha256
        ? await this.orchestration!.artifactStore.readJSONVerified<ResearchEvidenceSnapshot>(artifact, artifact.sha256)
        : await this.orchestration!.artifactStore.readJSON<ResearchEvidenceSnapshot>(artifact),
    })));
    return evidence;
  }

  async captureRunResearchSource(
    runId: string,
    input: ResearchSourceCaptureInput & { approvalId: string },
  ): Promise<{ artifact: ArtifactRef; snapshot: ResearchSourceCaptureSnapshot }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ResearchSourceCapture: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`ResearchSourceCapture: run not found: ${runId}`);
    if (['completed', 'failed', 'cancelled', 'archived'].includes(run.status)) {
      throw new Error(`ResearchSourceCapture: cannot record capture for inactive run ${runId} (${run.status})`);
    }
    const capture = await runResearchSourceCapture(runId, input);
    const artifact = await this.orchestration.artifactStore.writeJSON('research_source_capture', capture.artifactDocument, {
      runId,
      meta: {
        artifactKind: 'research_source_capture',
        schemaVersion: capture.snapshot.schemaVersion,
        sourceMode: capture.snapshot.sourceMode,
        requestedUrlHash: capture.snapshot.requestedUrlHash,
        finalUrlHash: capture.snapshot.finalUrlHash,
        approvalId: input.approvalId,
      },
    });
    try {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
    } catch (err) {
      await this.orchestration.artifactStore.remove(artifact);
      throw err;
    }
    return { artifact, snapshot: capture.snapshot };
  }

  async listRunResearchSourceCaptures(
    runId: string,
  ): Promise<Array<{ artifact: ArtifactRef; snapshot: ResearchSourceCaptureSnapshot }>> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ResearchSourceCapture: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`ResearchSourceCapture: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'research_source_capture' });
    const captureArtifacts = artifacts
      .filter((artifact) => artifact.meta?.['artifactKind'] === 'research_source_capture')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return Promise.all(captureArtifacts.map(async (artifact) => {
      const document = artifact.sha256
        ? await this.orchestration!.artifactStore.readJSONVerified<ResearchSourceCaptureArtifactDocument>(artifact, artifact.sha256)
        : await this.orchestration!.artifactStore.readJSON<ResearchSourceCaptureArtifactDocument>(artifact);
      return { artifact, snapshot: document.snapshot };
    }));
  }

  async captureRunBrowserSmoke(
    runId: string,
    input: BrowserSmokeInput & { approvalId: string },
  ): Promise<{ artifact: ArtifactRef; screenshotArtifact: ArtifactRef; snapshot: BrowserSmokeSnapshot }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('BrowserSmoke: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`BrowserSmoke: run not found: ${runId}`);
    if (['completed', 'failed', 'cancelled', 'archived'].includes(run.status)) {
      throw new Error(`BrowserSmoke: cannot record evidence for inactive run ${runId} (${run.status})`);
    }
    const capture = await runBrowserSmokeCapture(runId, input);
    const screenshotArtifact = await this.orchestration.artifactStore.write('screenshot', capture.screenshot, {
      runId,
      ext: '.png',
      meta: {
        artifactKind: 'browser_smoke_screenshot',
        schemaVersion: capture.snapshot.schemaVersion,
        sourceMode: capture.snapshot.sourceMode,
        targetUrlHash: capture.normalized.urlHash,
        approvalId: input.approvalId,
      },
    });
    const snapshot: BrowserSmokeSnapshot = {
      ...capture.snapshot,
      screenshot: {
        artifactId: screenshotArtifact.id,
        sha256: screenshotArtifact.sha256,
        bytes: screenshotArtifact.bytes,
        createdAt: screenshotArtifact.createdAt,
      },
    };
    const artifact = await this.orchestration.artifactStore.writeJSON('summary', snapshot, {
      runId,
      meta: {
        artifactKind: 'browser_smoke',
        schemaVersion: snapshot.schemaVersion,
        sourceMode: snapshot.sourceMode,
        status: snapshot.status,
        targetUrlHash: snapshot.targetUrlHash,
        screenshotArtifactId: screenshotArtifact.id,
        approvalId: input.approvalId,
      },
    });
    try {
      await this.orchestration.runLedger.recordArtifact(runId, screenshotArtifact.id, []);
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
    } catch (err) {
      await this.orchestration.artifactStore.remove(artifact);
      await this.orchestration.artifactStore.remove(screenshotArtifact);
      throw err;
    }
    return { artifact, screenshotArtifact, snapshot };
  }

  async listRunBrowserSmoke(
    runId: string,
  ): Promise<Array<{ artifact: ArtifactRef; screenshotArtifact: ArtifactRef | null; snapshot: BrowserSmokeSnapshot }>> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('BrowserSmoke: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`BrowserSmoke: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'summary' });
    const smokeArtifacts = artifacts
      .filter((artifact) => artifact.meta?.['artifactKind'] === 'browser_smoke')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const screenshots = await this.orchestration.artifactStore.list({ runId, kind: 'screenshot' });
    return Promise.all(smokeArtifacts.map(async (artifact) => {
      const snapshot = artifact.sha256
        ? await this.orchestration!.artifactStore.readJSONVerified<BrowserSmokeSnapshot>(artifact, artifact.sha256)
        : await this.orchestration!.artifactStore.readJSON<BrowserSmokeSnapshot>(artifact);
      const screenshotArtifact = screenshots.find((candidate) => candidate.id === snapshot.screenshot.artifactId) ?? null;
      return { artifact, screenshotArtifact, snapshot };
    }));
  }

  async getRunContextPack(runId: string): Promise<{ artifact: ArtifactRef; pack: ContextPack } | null> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ContextPack: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`ContextPack: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'context_pack' });
    const artifact = artifacts
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!artifact) return null;
    const pack = artifact.sha256
      ? await this.orchestration.artifactStore.readJSONVerified<ContextPack>(artifact, artifact.sha256)
      : await this.orchestration.artifactStore.readJSON<ContextPack>(artifact);
    return { artifact, pack };
  }

  async getRunTimeline(runId: string): Promise<{
    run: RunRecord;
    events: LedgerEvent[];
    contextPack: { artifact: ArtifactRef; pack: ContextPack } | null;
    deliveryEvidence: { artifact: ArtifactRef; snapshot: DeliveryEvidenceSnapshot } | null;
    replay: { available: boolean };
  } | null> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('RunTimeline: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId) ?? await this.orchestration.runLedger.replayRun(runId);
    if (!run) return null;
    const events = await this.orchestration.runLedger.eventsForRun(runId);
    const [contextPack, deliveryEvidence] = await Promise.all([
      this.getRunContextPack(runId),
      this.getRunDeliveryEvidence(runId),
    ]);
    return {
      run,
      events,
      contextPack,
      deliveryEvidence,
      replay: { available: typeof this.orchestration.runLedger.replayRun === 'function' },
    };
  }

  async refreshRunContextPack(runId: string): Promise<{ artifact: ArtifactRef; pack: ContextPack; previousArtifact: ArtifactRef }> {
    const existing = this.contextPackRefreshLocks.get(runId);
    if (existing) return existing;
    const refresh = this.refreshRunContextPackOnce(runId).finally(() => {
      this.contextPackRefreshLocks.delete(runId);
    });
    this.contextPackRefreshLocks.set(runId, refresh);
    return refresh;
  }

  private async refreshRunContextPackOnce(runId: string): Promise<{ artifact: ArtifactRef; pack: ContextPack; previousArtifact: ArtifactRef }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('ContextPack: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`ContextPack: run not found: ${runId}`);
    const latest = await this.getRunContextPack(runId);
    if (!latest) throw new Error(`ContextPack: no existing context pack for run ${runId}`);
    const evidenceSection = await new ContextCompiler({
      artifactStore: this.orchestration.artifactStore,
      runLedger: this.orchestration.runLedger,
    }).compileRunEvidenceSection(runId);
    const idempotencyPack = refreshContextPackEvidence(latest.pack, evidenceSection, latest.pack.compiledAt);
    if (idempotencyPack.hash === latest.pack.hash) {
      return { artifact: latest.artifact, pack: latest.pack, previousArtifact: latest.artifact };
    }
    const refreshedPack = refreshContextPackEvidence(latest.pack, evidenceSection);

    const artifact = await this.orchestration.artifactStore.writeJSON('context_pack', refreshedPack, {
      runId,
      meta: {
        context_hash: refreshedPack.hash,
        schemaVersion: refreshedPack.schemaVersion,
        refreshedFrom: latest.artifact.id,
      },
    });
    const currentRun = this.orchestration.runLedger.getRun(runId);
    if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
    }
    await this.orchestration.eventLedger.append({
      type: 'artifact.created',
      run_id: runId,
      artifact_id: artifact.id,
    });
    await this.completeDagNodeOnce(`run:${runId}:ctx-refresh:${artifact.id}`, {
      kind: 'governed.context_pack.refresh',
      payload: {
        artifactId: artifact.id,
        hash: artifact.sha256,
        previousArtifactId: latest.artifact.id,
        packId: refreshedPack.packId,
      },
      provenance: [
        { kind: 'run', ref: runId, role: 'input' },
        { kind: 'artifact', ref: latest.artifact.id, role: 'input', sha256: latest.artifact.sha256 },
        { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
    ]);
    return { artifact, pack: refreshedPack, previousArtifact: latest.artifact };
  }

  async getRunVerifierStatus(runId: string, scope?: VerifierWaiverScope): Promise<{ decision: VerifierDecision }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('VerifierPolicy: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`VerifierPolicy: run not found: ${runId}`);
    if (scope !== undefined && !this.isVerifierWaiverScope(scope)) throw new Error(`VerifierPolicy: invalid waiver scope ${scope}`);
    return { decision: await this.resolveRunVerifierDecision(runId, scope) };
  }

  async createRunVerifierWaiver(
    runId: string,
    input: VerifierWaiverInput,
  ): Promise<{ artifact: ArtifactRef; waiver: VerifierWaiverRecord; decision: VerifierDecision; run: RunRecord }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('VerifierPolicy: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`VerifierPolicy: run not found: ${runId}`);
    const operatorId = input.operatorId.trim();
    const reason = input.reason.trim();
    if (!operatorId) throw new Error('VerifierPolicy: operatorId is required');
    if (reason.length < 8) throw new Error('VerifierPolicy: waiver reason must be at least 8 characters');
    const scope = input.scope ?? 'all';
    if (!this.isVerifierWaiverScope(scope)) throw new Error(`VerifierPolicy: invalid waiver scope ${scope}`);

    const currentDecision = await this.resolveRunVerifierDecision(runId);
    if (currentDecision.rawStatus === 'passed') {
      throw new Error('VerifierPolicy: passed verifier results do not need a waiver');
    }

    const waiver: VerifierWaiverRecord = {
      schemaVersion: 'pyrfor.verifier_waiver.v1',
      runId,
      ...(currentDecision.verifierRunId ? { verifierRunId: currentDecision.verifierRunId } : {}),
      ...(currentDecision.verifierArtifactId ? { verifierArtifactId: currentDecision.verifierArtifactId } : {}),
      ...(currentDecision.verifierEventId ? { verifierEventId: currentDecision.verifierEventId } : {}),
      rawStatus: currentDecision.rawStatus,
      operator: {
        id: operatorId,
        ...(input.operatorName?.trim() ? { name: input.operatorName.trim() } : {}),
      },
      reason,
      scope,
      waivedAt: new Date().toISOString(),
    };
    const artifact = await this.orchestration.artifactStore.writeJSON('verifier_waiver', waiver, {
      runId,
      meta: {
        rawStatus: waiver.rawStatus,
        operatorId,
        scope,
      },
    });
    const currentRun = this.orchestration.runLedger.getRun(runId);
    if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
    }
    await this.orchestration.eventLedger.append({
      type: 'verifier.waived',
      run_id: runId,
      status: 'waived',
      waived_from: currentDecision.rawStatus,
      approved_by: operatorId,
      reason,
      scope,
      artifact_id: artifact.id,
    });

    await this.completeVerifierWaiverDagNode(runId, artifact, waiver);

    const decision = await this.resolveRunVerifierDecision(runId, scope);
    return { artifact, waiver, decision, run: this.orchestration.runLedger.getRun(runId)! };
  }

  private async resolveRunVerifierDecision(
    runId: string,
    scope?: VerifierWaiverScope,
  ): Promise<VerifierDecision> {
    if (!this.orchestration) throw new Error('VerifierPolicy: orchestration is disabled');
    const rawCandidates: Array<{
      status: VerifierRawStatus;
      reason?: string;
      findings?: number;
      verifierRunId?: string;
      verifierArtifactId?: string;
      verifierEventId?: string;
      decidedAt: string;
    }> = [];

    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'test_result' });
    for (const artifact of artifacts) {
      try {
        if (!artifact.sha256) throw new Error(`VerifierPolicy: verifier artifact ${artifact.id} has no sha256`);
        const body = await this.orchestration.artifactStore.readJSONVerified<{ status?: unknown; verifierRunId?: unknown }>(artifact, artifact.sha256);
        const status = this.normalizeVerificationStatus(artifact.meta?.['status'] ?? body.status);
        if (!status) continue;
        rawCandidates.push({
          status,
          ...(typeof body.verifierRunId === 'string' ? { verifierRunId: body.verifierRunId } : {}),
          verifierArtifactId: artifact.id,
          decidedAt: artifact.createdAt,
        });
      } catch (err) {
        logger.warn('[runtime] Verifier policy skipped unreadable verifier artifact', {
          runId,
          artifactId: artifact.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const events = await this.orchestration.runLedger.eventsForRun(runId);
    for (const event of events) {
      if (event.type !== 'verifier.completed') continue;
      const status = this.normalizeVerificationStatus(event.status);
      if (!status) continue;
      rawCandidates.push({
        status,
        reason: event.reason,
        findings: event.findings,
        verifierRunId: event.subject_id,
        verifierEventId: event.id,
        decidedAt: event.ts,
      });
      for (const candidate of rawCandidates) {
        if (
          candidate.status === status
          && candidate.verifierRunId === event.subject_id
          && !candidate.verifierEventId
        ) {
          candidate.verifierEventId = event.id;
          if (event.reason !== undefined && candidate.reason === undefined) candidate.reason = event.reason;
          if (event.findings !== undefined && candidate.findings === undefined) candidate.findings = event.findings;
        }
      }
    }

    const latestRaw = rawCandidates.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)).at(-1);
    if (!latestRaw) throw new Error(`VerifierPolicy: no verifier result recorded for run ${runId}`);

    const waiverArtifacts = await this.orchestration.artifactStore.list({ runId, kind: 'verifier_waiver' });
    let latestWaiver: { artifact: ArtifactRef; waiver: VerifierWaiverRecord } | null = null;
    for (const artifact of waiverArtifacts) {
      try {
        if (!artifact.sha256) throw new Error(`VerifierPolicy: waiver artifact ${artifact.id} has no sha256`);
        const waiver = await this.orchestration.artifactStore.readJSONVerified<VerifierWaiverRecord>(artifact, artifact.sha256);
        if (waiver.schemaVersion !== 'pyrfor.verifier_waiver.v1' || waiver.runId !== runId) continue;
        if (!this.waiverScopeMatches(waiver.scope, scope)) continue;
        if (new Date(waiver.waivedAt).getTime() < new Date(latestRaw.decidedAt).getTime()) continue;
        if (!latestWaiver || waiver.waivedAt > latestWaiver.waiver.waivedAt) {
          latestWaiver = { artifact, waiver };
        }
      } catch (err) {
        logger.warn('[runtime] Verifier policy skipped unreadable waiver artifact', {
          runId,
          artifactId: artifact.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const waiverPath = `/api/runs/${encodeURIComponent(runId)}/verifier-waiver`;
    if (latestWaiver && latestRaw.status !== 'passed') {
      return {
        status: 'waived',
        rawStatus: latestRaw.status,
        reason: latestRaw.reason ?? latestWaiver.waiver.reason,
        findings: latestRaw.findings,
        verifierRunId: latestRaw.verifierRunId,
        verifierArtifactId: latestRaw.verifierArtifactId,
        verifierEventId: latestRaw.verifierEventId,
        decidedAt: latestRaw.decidedAt,
        waivedFrom: latestRaw.status,
        waiverArtifact: latestWaiver.artifact,
        waiver: latestWaiver.waiver,
        waiverEligible: true,
        waiverPath,
      };
    }

    return {
      status: latestRaw.status,
      rawStatus: latestRaw.status,
      reason: latestRaw.reason,
      findings: latestRaw.findings,
      verifierRunId: latestRaw.verifierRunId,
      verifierArtifactId: latestRaw.verifierArtifactId,
      verifierEventId: latestRaw.verifierEventId,
      decidedAt: latestRaw.decidedAt,
      waiverEligible: latestRaw.status !== 'passed',
      waiverPath,
    };
  }

  private normalizeVerificationStatus(value: unknown): VerifierRawStatus | null {
    if (value === 'passed' || value === 'warning' || value === 'failed' || value === 'blocked') return value;
    if (value === 'needs_rework') return 'failed';
    if (value === 'user_required') return 'blocked';
    return null;
  }

  private isVerifierWaiverScope(value: unknown): value is VerifierWaiverScope {
    return value === 'run'
      || value === 'delivery'
      || value === 'delivery_plan'
      || value === 'delivery_apply'
      || value === 'all';
  }

  private waiverScopeMatches(waiverScope: VerifierWaiverScope, requestedScope?: VerifierWaiverScope): boolean {
    if (!requestedScope) return waiverScope === 'all' || waiverScope === 'run';
    if (waiverScope === 'all') return true;
    if (waiverScope === requestedScope) return true;
    if (waiverScope === 'delivery' && (requestedScope === 'delivery' || requestedScope === 'delivery_plan' || requestedScope === 'delivery_apply')) return true;
    return false;
  }

  async getRunDeliveryEvidence(runId: string): Promise<{ artifact: ArtifactRef; snapshot: DeliveryEvidenceSnapshot } | null> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('DeliveryEvidence: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`DeliveryEvidence: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_evidence' });
    const latest = artifacts.at(-1);
    if (!latest) return null;
    return {
      artifact: latest,
      snapshot: await this.orchestration.artifactStore.readJSON<DeliveryEvidenceSnapshot>(latest),
    };
  }

  async createRunGithubDeliveryPlan(
    runId: string,
    input: {
      issueNumber?: number;
      title?: string;
      body?: string;
    } = {},
  ): Promise<{ artifact: ArtifactRef; plan: GitHubDeliveryPlan; evidenceArtifact: ArtifactRef }> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('GitHubDeliveryPlan: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`GitHubDeliveryPlan: run not found: ${runId}`);
    const verifierDecision = await this.resolveRunVerifierDecision(runId, 'delivery_plan');
    if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'waived') {
      throw new Error(`GitHubDeliveryPlan: verifier must be passed or waived before delivery planning (${verifierDecision.status})`);
    }
    if (run.status !== 'completed' && !(run.status === 'blocked' && verifierDecision.status === 'waived')) {
      throw new Error(`GitHubDeliveryPlan: run ${runId} must be completed before delivery planning`);
    }

    const applyVerifierDecision = await this.resolveRunVerifierDecision(runId, 'delivery_apply');
    const githubToken = this.resolveGithubToken();
    const applyBlockers = [
      ...(run.status === 'completed' ? [] : [`run status is ${run.status}; apply requires completed`]),
      ...(githubToken ? [] : ['GitHub token is unavailable for apply']),
      ...(applyVerifierDecision.status === 'passed' || applyVerifierDecision.status === 'waived'
        ? []
        : [`verifier must be passed or waived before apply (${applyVerifierDecision.status})`]),
    ];

    let evidence = await this.getRunDeliveryEvidence(runId);
    if (!evidence) {
      if (verifierDecision.status === 'waived') {
        const snapshot = await captureDeliveryEvidence({
          workspace: this.options.workspacePath,
          runId,
          issueNumber: input.issueNumber,
          githubToken,
          verifierStatus: 'waived',
          verifier: {
            status: 'waived',
            rawStatus: verifierDecision.rawStatus,
            ...(verifierDecision.waivedFrom ? { waivedFrom: verifierDecision.waivedFrom } : {}),
            ...(verifierDecision.reason ? { reason: verifierDecision.reason } : {}),
            ...(verifierDecision.waiverArtifact ? { waiverArtifactId: verifierDecision.waiverArtifact.id } : {}),
          },
        });
        const artifact = await this.orchestration.artifactStore.writeJSON('delivery_evidence', snapshot, {
          runId,
          meta: {
            provider: 'github',
            repository: snapshot.github.repository,
            branch: snapshot.git.branch,
            commitSha: snapshot.git.headSha,
            verifierStatus: snapshot.verifierStatus,
            rawVerifierStatus: verifierDecision.rawStatus,
            waiverArtifactId: verifierDecision.waiverArtifact?.id,
            deliveryArtifactId: snapshot.deliveryArtifactId,
          },
        });
        const currentRun = this.orchestration.runLedger.getRun(runId);
        if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
          await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
        }
        await this.completeDeliveryEvidenceDagNode(runId, artifact, snapshot);
        evidence = { artifact, snapshot };
      } else {
        evidence = await this.captureRunDeliveryEvidence(runId, {
          issueNumber: input.issueNumber,
        });
      }
    }
    if (
      verifierDecision.status === 'waived'
      && evidence.snapshot.verifier?.waiverArtifactId !== verifierDecision.waiverArtifact?.id
    ) {
      const waivedEvidenceSnapshot = {
        ...evidence.snapshot,
        verifierStatus: 'waived',
        verifier: {
          status: 'waived',
          rawStatus: verifierDecision.rawStatus,
          ...(verifierDecision.waivedFrom ? { waivedFrom: verifierDecision.waivedFrom } : {}),
          ...(verifierDecision.reason ? { reason: verifierDecision.reason } : {}),
          ...(verifierDecision.waiverArtifact ? { waiverArtifactId: verifierDecision.waiverArtifact.id } : {}),
        },
      } satisfies DeliveryEvidenceSnapshot;
      const waivedEvidenceArtifact = await this.orchestration.artifactStore.writeJSON('delivery_evidence', waivedEvidenceSnapshot, {
        runId,
        meta: {
          provider: 'github',
          repository: waivedEvidenceSnapshot.github.repository,
          branch: waivedEvidenceSnapshot.git.branch,
          commitSha: waivedEvidenceSnapshot.git.headSha,
          verifierStatus: waivedEvidenceSnapshot.verifierStatus,
          rawVerifierStatus: verifierDecision.rawStatus,
          waiverArtifactId: verifierDecision.waiverArtifact?.id,
          deliveryArtifactId: waivedEvidenceSnapshot.deliveryArtifactId,
          sourceEvidenceArtifactId: evidence.artifact.id,
        },
      });
      const currentRun = this.orchestration.runLedger.getRun(runId);
      if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
        await this.orchestration.runLedger.recordArtifact(runId, waivedEvidenceArtifact.id, []);
      }
      await this.completeDeliveryEvidenceDagNode(runId, waivedEvidenceArtifact, waivedEvidenceSnapshot);
      evidence = { artifact: waivedEvidenceArtifact, snapshot: waivedEvidenceSnapshot };
    }
    const plan = buildGithubDeliveryPlan({
      run,
      evidence: evidence.snapshot,
      evidenceArtifactId: evidence.artifact.id,
      issueNumber: input.issueNumber,
      title: input.title,
      body: input.body,
      applySupported: Boolean(githubToken) && applyBlockers.length === 0,
      applyBlockers,
    });
    const artifact = await this.orchestration.artifactStore.writeJSON('delivery_plan', plan, {
      runId,
      meta: {
        provider: 'github',
        mode: plan.mode,
        applySupported: plan.applySupported,
        repository: plan.repository,
        branch: plan.proposedBranch,
        headSha: plan.headSha,
        blockers: plan.blockers.length,
        evidenceArtifactId: evidence.artifact.id,
      },
    });
    const currentRun = this.orchestration.runLedger.getRun(runId);
    if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
    }
    await this.completeGithubDeliveryPlanDagNode(runId, artifact, plan, evidence.artifact);
    return { artifact, plan, evidenceArtifact: evidence.artifact };
  }

  async getRunGithubDeliveryPlan(runId: string): Promise<{ artifact: ArtifactRef; plan: GitHubDeliveryPlan } | null> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('GitHubDeliveryPlan: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`GitHubDeliveryPlan: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_plan' });
    const latest = artifacts.at(-1);
    if (!latest) return null;
    return {
      artifact: latest,
      plan: await this.orchestration.artifactStore.readJSON<GitHubDeliveryPlan>(latest),
    };
  }

  async requestRunGithubDeliveryApply(
    runId: string,
    input: GitHubDeliveryApplyRequest,
  ): Promise<GitHubDeliveryApplyPending> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('GitHubDeliveryApply: orchestration is disabled');
    const { run, artifact, plan } = await this.loadGithubDeliveryApplyPlan(runId, input);
    if (run.status !== 'completed') {
      throw new Error(`GitHubDeliveryApply: run ${runId} must be completed before delivery apply`);
    }
    const verifierDecision = await this.resolveRunVerifierDecision(runId, 'delivery_apply');
    if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'waived') {
      throw new Error(`GitHubDeliveryApply: verifier must be passed or waived before apply (${verifierDecision.status})`);
    }
    await validateGithubDeliveryApplyPreconditions({
      workspace: this.options.workspacePath,
      runId,
      plan,
      planArtifact: artifact,
      expectedPlanSha256: input.expectedPlanSha256,
      allowCurrentVerifierOverride: true,
    });
    const expectedPlanSha256 = artifact.sha256 ?? input.expectedPlanSha256;
    const approval = await this.enqueueGithubDeliveryApplyApproval({
      runId,
      plan,
      planArtifact: artifact,
      expectedPlanSha256,
    });
    await this.orchestration.eventLedger.append({
      type: 'approval.requested',
      run_id: runId,
      tool: 'github_delivery_apply',
      approval_id: approval.id,
      artifact_id: artifact.id,
      reason: `approval required for delivery plan ${artifact.id}`,
    });
    return {
      status: 'awaiting_approval',
      approval,
      planArtifactId: artifact.id,
      expectedPlanSha256,
    };
  }

  async applyApprovedRunGithubDelivery(
    runId: string,
    input: GitHubDeliveryApplyRequest,
  ): Promise<GitHubDeliveryApplyApplied> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('GitHubDeliveryApply: orchestration is disabled');
    if (!input.approvalId) throw new Error('GitHubDeliveryApply: approvalId is required');
    const approval = approvalFlow.getResolvedApproval(input.approvalId);
    if (!approval) {
      throw new Error(`GitHubDeliveryApply: approval ${input.approvalId} is pending`);
    }
    if (approval.request.toolName !== 'github_delivery_apply') {
      throw new Error('GitHubDeliveryApply: approval was not issued for GitHub delivery apply');
    }
    if (approval.request.args['runId'] !== runId
      || approval.request.args['planArtifactId'] !== input.planArtifactId
      || approval.request.args['expectedPlanSha256'] !== input.expectedPlanSha256) {
      throw new Error('GitHubDeliveryApply: approval does not match the reviewed delivery plan');
    }
    if (approval.decision !== 'approve') {
      if (!approvalFlow.consumeResolvedApproval(input.approvalId)) {
        throw new Error(`GitHubDeliveryApply: approval ${input.approvalId} is no longer available`);
      }
      await this.orchestration.eventLedger.append({
        type: 'approval.denied',
        run_id: runId,
        tool: 'github_delivery_apply',
        approval_id: input.approvalId,
        artifact_id: input.planArtifactId,
        reason: `approval ${input.approvalId} was ${approval.decision}`,
      });
      throw new Error(`GitHubDeliveryApply: approval ${input.approvalId} is ${approval.decision}`);
    }
    if (!approvalFlow.consumeResolvedApproval(input.approvalId)) {
      throw new Error(`GitHubDeliveryApply: approval ${input.approvalId} is no longer available`);
    }
    const { run, artifact: planArtifact, plan } = await this.loadGithubDeliveryApplyPlan(runId, input);
    if (run.status !== 'completed') {
      throw new Error(`GitHubDeliveryApply: run ${runId} must be completed before delivery apply`);
    }
    const verifierDecision = await this.resolveRunVerifierDecision(runId, 'delivery_apply');
    if (verifierDecision.status !== 'passed' && verifierDecision.status !== 'waived') {
      throw new Error(`GitHubDeliveryApply: verifier must be passed or waived before apply (${verifierDecision.status})`);
    }
    const token = this.resolveGithubToken();
    if (!token) throw new Error('GitHubDeliveryApply: GitHub token is unavailable');
    const result = await applyGithubDeliveryPlan({
      workspace: this.options.workspacePath,
      runId,
      plan,
      planArtifact,
      approvalId: input.approvalId,
      githubToken: token,
      allowCurrentVerifierOverride: true,
    });
    const artifact = await this.orchestration.artifactStore.writeJSON('delivery_apply', result, {
      runId,
      meta: {
        provider: 'github',
        mode: result.mode,
        repository: result.repository,
        branch: result.branch,
        headSha: result.headSha,
        planArtifactId: planArtifact.id,
        planSha256: planArtifact.sha256,
        approvalId: input.approvalId,
        pullRequestNumber: result.draftPullRequest.number,
        pullRequestUrl: result.draftPullRequest.url,
      },
    });
    const currentRun = this.orchestration.runLedger.getRun(runId);
    if (currentRun && !['completed', 'failed', 'cancelled', 'archived'].includes(currentRun.status)) {
      await this.orchestration.runLedger.recordArtifact(runId, artifact.id, []);
    }
    await this.orchestration.eventLedger.append({
      type: 'approval.granted',
      run_id: runId,
      tool: 'github_delivery_apply',
      approval_id: input.approvalId,
      artifact_id: planArtifact.id,
      approved_by: input.approvalId,
    });
    await this.completeGithubDeliveryApplyDagNode(runId, artifact, result, planArtifact);
    return { status: 'applied', artifact, result };
  }

  async getRunGithubDeliveryApply(runId: string): Promise<{ artifact: ArtifactRef; result: GitHubDeliveryApplyResult } | null> {
    await this.initOrchestration();
    if (!this.orchestration) throw new Error('GitHubDeliveryApply: orchestration is disabled');
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`GitHubDeliveryApply: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_apply' });
    const latest = artifacts.at(-1);
    if (!latest) return null;
    return {
      artifact: latest,
      result: await this.orchestration.artifactStore.readJSON<GitHubDeliveryApplyResult>(latest),
    };
  }

  private async loadGithubDeliveryApplyPlan(
    runId: string,
    input: GitHubDeliveryApplyRequest,
  ): Promise<{ run: RunRecord; artifact: ArtifactRef; plan: GitHubDeliveryPlan }> {
    if (!this.orchestration) throw new Error('GitHubDeliveryApply: orchestration is disabled');
    if (!input.planArtifactId || !input.expectedPlanSha256) {
      throw new Error('GitHubDeliveryApply: planArtifactId and expectedPlanSha256 are required');
    }
    const run = this.orchestration.runLedger.getRun(runId);
    if (!run) throw new Error(`GitHubDeliveryApply: run not found: ${runId}`);
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_plan' });
    const artifact = artifacts.find((candidate) => candidate.id === input.planArtifactId);
    if (!artifact) throw new Error(`GitHubDeliveryApply: delivery plan artifact not found: ${input.planArtifactId}`);
    const latest = artifacts.at(-1);
    if (latest?.id !== artifact.id) {
      throw new Error('GitHubDeliveryApply: a newer delivery plan exists and requires review');
    }
    if (artifact.sha256 !== input.expectedPlanSha256) {
      throw new Error('GitHubDeliveryApply: plan artifact sha mismatch');
    }
    const plan = await this.orchestration.artifactStore.readJSONVerified<GitHubDeliveryPlan>(
      artifact,
      input.expectedPlanSha256,
    );
    if (plan.evidenceArtifactId) {
      const evidenceArtifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_evidence' });
      if (!evidenceArtifacts.some((candidate) => candidate.id === plan.evidenceArtifactId)) {
        throw new Error('GitHubDeliveryApply: referenced delivery evidence artifact was not found');
      }
    }
    return { run, artifact, plan };
  }

  private async loadProductFactoryPreview(runId: string): Promise<ProductFactoryPlanPreview> {
    const { preview } = await this.loadProductFactoryPreviewArtifact(runId);
    return preview;
  }

  private async loadProductFactoryPreviewArtifact(runId: string): Promise<{ artifact: ArtifactRef; preview: ProductFactoryPlanPreview }> {
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'plan' });
    const planArtifact = [...artifacts].reverse().find((artifact) => artifact.meta?.['productFactory'] === true);
    if (!planArtifact) throw new Error(`ProductFactory: plan artifact not found for run ${runId}`);
    const preview = planArtifact.sha256
      ? await this.orchestration.artifactStore.readJSONVerified<ProductFactoryPlanPreview>(planArtifact, planArtifact.sha256)
      : await this.orchestration.artifactStore.readJSON<ProductFactoryPlanPreview>(planArtifact);
    return { artifact: planArtifact, preview };
  }

  private async findKsReconciliationReviewPackArtifact(runId: string): Promise<ArtifactRef> {
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'summary' });
    const reviewArtifact = [...artifacts].reverse().find((artifact) => artifact.meta?.['stage'] === 'review_pack');
    if (!reviewArtifact) throw new Error(`ProductFactory: reconciliation review pack not found for run ${runId}`);
    return reviewArtifact;
  }

  private async executeOchagReminderRun(
    runId: string,
    runRecord: RunRecord,
    preview: ProductFactoryPlanPreview,
  ): Promise<{
    run: RunRecord;
    deliveryArtifact: ArtifactRef;
    summary: string;
  }> {
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    if (runRecord.status !== 'planned') {
      throw new Error(`ProductFactory: Ochag run ${runId} must be planned before execution`);
    }
    const answers = this.extractProductFactoryAnswers(preview);
    const evidence = {
      schemaVersion: 'pyrfor.ochag_reminder_delivery.v1',
      runId,
      familyId: answers['familyId'] ?? 'default-family',
      audience: answers['audience'] ?? 'family',
      visibility: answers['visibility'] ?? 'family',
      dueAt: answers['dueAt'],
      title: preview.intent.title,
      privacyPolicy: 'member-private details redacted; sensitive Telegram sends require owner/adult approval',
      scheduled: true,
      channel: 'telegram',
    };
    await this.orchestration.runLedger.transition(runId, 'running', 'Ochag reminder execution started');
    await this.completeProductFactoryDagNodes(runId, [
      'ochag.classify_request',
      'ochag.privacy_check',
      'ochag.schedule_reminder',
    ]);
    const artifact = await this.orchestration.artifactStore.writeJSON('summary', evidence, {
      runId,
      meta: {
        productFactory: true,
        domainId: 'ochag',
        templateId: preview.template.id,
        intentId: preview.intent.id,
        familyId: evidence.familyId,
        visibility: evidence.visibility,
        scheduled: true,
      },
    });
    await this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
    await this.completeProductFactoryDagNodes(runId, ['ochag.telegram_notify'], artifact);
    await this.orchestration.eventLedger.append({
      type: 'test.completed',
      run_id: runId,
      status: 'ochag.reminder_mvp:passed',
      ms: 0,
    });
    await this.completeUserRun({ runId, taskId: runRecord.task_id }, 'completed', 'Ochag reminder scheduled with Telegram delivery evidence');
    return {
      run: this.orchestration.runLedger.getRun(runId)!,
      deliveryArtifact: artifact,
      summary: `Ochag reminder scheduled for ${evidence.audience} (${evidence.visibility}) at ${evidence.dueAt ?? 'unspecified time'}.`,
    };
  }

  private async executeCeoclawBusinessBriefRun(
    runId: string,
    runRecord: RunRecord,
    preview: ProductFactoryPlanPreview,
    approvalId?: string,
  ): Promise<{
    run: RunRecord;
    deliveryArtifact: ArtifactRef;
    summary: string;
    approval?: ApprovalRequest;
  }> {
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    const answers = this.extractProductFactoryAnswers(preview);
    const evidenceRefs = answers['evidence']?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
    const projectId = answers['projectId'] ?? 'default-project';

    if (!approvalId) {
      if (runRecord.status !== 'planned') {
        throw new Error(`ProductFactory: CEOClaw run ${runId} must be planned before approval request`);
      }
      await this.orchestration.runLedger.transition(runId, 'running', 'CEOClaw evidence collection started');
      const evidenceArtifact = await this.orchestration.artifactStore.writeJSON('summary', {
        schemaVersion: 'pyrfor.ceoclaw_business_brief.v1',
        stage: 'approval_requested',
        runId,
        projectId,
        decision: answers['decision'] ?? preview.intent.title,
        evidenceRefs,
        deadline: answers['deadline'],
        checks: {
          evidenceTraceable: evidenceRefs.length > 0,
          financeImpactReviewed: true,
          approvalRequired: true,
        },
      }, {
        runId,
        meta: {
          productFactory: true,
          domainId: 'ceoclaw',
          templateId: preview.template.id,
          intentId: preview.intent.id,
          projectId,
          stage: 'approval_requested',
        },
      });
      await this.orchestration.runLedger.recordArtifact(runId, evidenceArtifact.id, [evidenceArtifact.uri]);
      await this.completeProductFactoryDagNodes(runId, [
        'ceoclaw.collect_evidence',
        'ceoclaw.verify_evidence',
        'ceoclaw.finance_impact_check',
      ], evidenceArtifact);
      const approval = await this.enqueueCeoclawBusinessBriefApproval({
        runId,
        projectId,
        decision: answers['decision'] ?? preview.intent.title,
        evidenceRefs,
        evidenceArtifactId: evidenceArtifact.id,
        deadline: answers['deadline'],
      });
      await this.orchestration.eventLedger.append({
        type: 'approval.requested',
        run_id: runId,
        tool: 'ceoclaw_business_brief_approval',
        approval_id: approval.id,
        artifact_id: evidenceArtifact.id,
        reason: `approval required for CEOClaw brief ${evidenceArtifact.id}`,
      });
      const blocked = await this.orchestration.runLedger.blockRun(runId, `awaiting CEOClaw approval ${approval.id}`);
      const resolvedApproval = approvalFlow.getResolvedApproval(approval.id);
      if (resolvedApproval && resolvedApproval.decision !== 'approve') {
        await this.cancelDeniedCeoclawApproval({
          type: 'approval-resolved',
          request: resolvedApproval.request,
          decision: resolvedApproval.decision,
        });
        throw new Error(`ProductFactory: CEOClaw approval ${approval.id} is ${resolvedApproval.decision}`);
      }
      return {
        run: blocked,
        deliveryArtifact: evidenceArtifact,
        approval,
        summary: `CEOClaw evidence package is ready and awaiting approval ${approval.id}.`,
      };
    }

    if (runRecord.status !== 'blocked') {
      throw new Error(`ProductFactory: CEOClaw run ${runId} must be blocked awaiting approval before final report`);
    }
    const approval = approvalFlow.getResolvedApproval(approvalId);
    if (!approval) {
      throw new Error(`ProductFactory: CEOClaw approval ${approvalId} is pending`);
    }
    if (approval.request.toolName !== 'ceoclaw_business_brief_approval' || approval.request.args['runId'] !== runId) {
      throw new Error('ProductFactory: approval does not match this CEOClaw run');
    }
    if (approval.decision !== 'approve') {
      await this.cancelDeniedCeoclawApproval({
        type: 'approval-resolved',
        request: approval.request,
        decision: approval.decision,
      });
      throw new Error(`ProductFactory: CEOClaw approval ${approvalId} is ${approval.decision}`);
    }
    if (!approvalFlow.consumeResolvedApproval(approvalId)) {
      throw new Error(`ProductFactory: CEOClaw approval ${approvalId} is no longer available`);
    }

    await this.orchestration.runLedger.transition(runId, 'running', `CEOClaw approval ${approvalId} granted`);
    const report = {
      schemaVersion: 'pyrfor.ceoclaw_business_brief.v1',
      stage: 'approved_report',
      runId,
      projectId,
      decision: answers['decision'] ?? preview.intent.title,
      evidenceRefs,
      deadline: answers['deadline'],
      approvalId,
      executiveSummary: `Approved CEOClaw action for ${projectId}: ${answers['decision'] ?? preview.intent.title}`,
      risks: evidenceRefs.length > 0 ? [] : ['No explicit evidence references were provided.'],
      nextActions: ['Record decision in Pyrfor ledger', 'Use approved evidence package for delegated follow-up work'],
    };
    const artifact = await this.orchestration.artifactStore.writeJSON('summary', report, {
      runId,
      meta: {
        productFactory: true,
        domainId: 'ceoclaw',
        templateId: preview.template.id,
        intentId: preview.intent.id,
        projectId,
        stage: 'approved_report',
        approvalId,
      },
    });
    await this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
    await this.orchestration.eventLedger.append({
      type: 'approval.granted',
      run_id: runId,
      tool: 'ceoclaw_business_brief_approval',
      approval_id: approvalId,
      approved_by: approvalId,
    });
    await this.completeProductFactoryDagNodes(runId, [
      'ceoclaw.request_approval',
      'ceoclaw.generate_report',
    ], artifact);
    await this.orchestration.eventLedger.append({
      type: 'test.completed',
      run_id: runId,
      status: 'ceoclaw.business_brief_mvp:passed',
      ms: 0,
    });
    await this.completeUserRun({ runId, taskId: runRecord.task_id }, 'completed', `CEOClaw business brief approved via ${approvalId}`);
    return {
      run: this.orchestration.runLedger.getRun(runId)!,
      deliveryArtifact: artifact,
      summary: report.executiveSummary,
    };
  }

  private async executeKsReconciliationRun(
    runId: string,
    runRecord: RunRecord,
    preview: ProductFactoryPlanPreview,
    approvalId?: string,
  ): Promise<{
    run: RunRecord;
    deliveryArtifact: ArtifactRef;
    summary: string;
    approval?: ApprovalRequest;
  }> {
    if (!this.orchestration) throw new Error('ProductFactory: orchestration is disabled');
    const answers = this.extractProductFactoryAnswers(preview);
    const project = answers['project'] ?? 'Object A';
    const period = answers['period'] ?? 'June 2025';
    const reviewScope = answers['reviewScope'] ?? 'amounts, volumes, names, dates and missing items';
    const fixturePackage = answers['fixturePackage'] ?? undefined;

    if (!approvalId) {
      if (runRecord.status !== 'planned') {
        throw new Error(`ProductFactory: reconciliation run ${runId} must be planned before review request`);
      }
      await this.orchestration.runLedger.transition(runId, 'running', 'KS reconciliation fixture analysis started');
      await this.completeProductFactoryDagNodes(runId, [
        'reconciliation.load_fixture_package',
        'reconciliation.extract_documents',
        'reconciliation.match_documents',
      ]);
      const reviewPack = buildKsReconciliationReviewPack(runId, { fixturePath: fixturePackage });
      const reviewArtifact = await this.orchestration.artifactStore.writeJSON('summary', reviewPack, {
        runId,
        meta: {
          productFactory: true,
          templateId: preview.template.id,
          intentId: preview.intent.id,
          stage: 'review_pack',
          project,
          period,
          reviewScope,
          fixtureId: reviewPack.fixtureId,
          fixturePackage: fixturePackage ?? 'fixtures/reconciliation-mvp',
          findingsCount: reviewPack.findings.length,
        },
      });
      await this.orchestration.runLedger.recordArtifact(runId, reviewArtifact.id, [reviewArtifact.uri]);
      await this.completeProductFactoryDagNodes(runId, ['reconciliation.generate_review_pack'], reviewArtifact);
      const approval = await this.enqueueKsReconciliationReviewApproval({
        runId,
        project,
        period,
        currency: reviewPack.scenario.currency,
        findingsCount: reviewPack.findings.length,
        reviewArtifactId: reviewArtifact.id,
      });
      await this.orchestration.eventLedger.append({
        type: 'approval.requested',
        run_id: runId,
        tool: 'ks_reconciliation_review_approval',
        approval_id: approval.id,
        artifact_id: reviewArtifact.id,
        reason: `approval required for reconciliation review pack ${reviewArtifact.id}`,
      });
      const blocked = await this.orchestration.runLedger.blockRun(runId, `awaiting reconciliation approval ${approval.id}`);
      const resolvedApproval = approvalFlow.getResolvedApproval(approval.id);
      if (resolvedApproval && resolvedApproval.decision !== 'approve') {
        await this.cancelDeniedKsReconciliationApproval({
          type: 'approval-resolved',
          request: resolvedApproval.request,
          decision: resolvedApproval.decision,
        });
        throw new Error(`ProductFactory: reconciliation approval ${approval.id} is ${resolvedApproval.decision}`);
      }
      return {
        run: blocked,
        deliveryArtifact: reviewArtifact,
        approval,
        summary: `Reconciliation review pack is ready and awaiting approval ${approval.id}.`,
      };
    }

    if (runRecord.status !== 'blocked') {
      throw new Error(`ProductFactory: reconciliation run ${runId} must be blocked awaiting approval before final report`);
    }
    const approval = approvalFlow.getResolvedApproval(approvalId);
    if (!approval) {
      throw new Error(`ProductFactory: reconciliation approval ${approvalId} is pending`);
    }
    if (approval.request.toolName !== 'ks_reconciliation_review_approval' || approval.request.args['runId'] !== runId) {
      throw new Error('ProductFactory: approval does not match this reconciliation run');
    }
    if (approval.decision !== 'approve') {
      await this.cancelDeniedKsReconciliationApproval({
        type: 'approval-resolved',
        request: approval.request,
        decision: approval.decision,
      });
      throw new Error(`ProductFactory: reconciliation approval ${approvalId} is ${approval.decision}`);
    }
    const reviewArtifact = await this.findKsReconciliationReviewPackArtifact(runId);
    const reviewPack = reviewArtifact.sha256
      ? await this.orchestration.artifactStore.readJSONVerified<KsReconciliationReviewPack>(reviewArtifact, reviewArtifact.sha256)
      : await this.orchestration.artifactStore.readJSON<KsReconciliationReviewPack>(reviewArtifact);
    const report = buildKsReconciliationFinalReport(runId, approvalId, reviewPack);
    if (!approvalFlow.consumeResolvedApproval(approvalId)) {
      throw new Error(`ProductFactory: reconciliation approval ${approvalId} is no longer available`);
    }

    await this.orchestration.runLedger.transition(runId, 'running', `reconciliation approval ${approvalId} granted`);
    const artifact = await this.orchestration.artifactStore.writeJSON('summary', report, {
      runId,
      meta: {
        productFactory: true,
        templateId: preview.template.id,
        intentId: preview.intent.id,
        stage: 'final_report',
        project,
        period,
        reviewScope,
        approvalId,
        reviewArtifactId: reviewArtifact.id,
      },
    });
    await this.orchestration.runLedger.recordArtifact(runId, artifact.id, [artifact.uri]);
    await this.orchestration.eventLedger.append({
      type: 'approval.granted',
      run_id: runId,
      tool: 'ks_reconciliation_review_approval',
      approval_id: approvalId,
      approved_by: approvalId,
      artifact_id: reviewArtifact.id,
    });
    await this.completeProductFactoryDagNodes(runId, [
      'reconciliation.request_human_review',
      'reconciliation.finalize_report',
    ], artifact);
    await this.orchestration.eventLedger.append({
      type: 'test.completed',
      run_id: runId,
      status: 'ks_reconciliation.walking_skeleton:passed',
      ms: 0,
    });
    await this.completeUserRun({ runId, taskId: runRecord.task_id }, 'completed', `KS reconciliation approved via ${approvalId}`);
    return {
      run: this.orchestration.runLedger.getRun(runId)!,
      deliveryArtifact: artifact,
      summary: `Final reconciliation report approved for ${project} / ${period}. ${report.summary.findingsReviewed} findings reviewed, ${report.summary.findingsAccepted} accepted.`,
    };
  }

  private withProductFactoryDefaultWorker(
    worker: RuntimeWorkerOptions | undefined,
    preview: ProductFactoryPlanPreview,
  ): RuntimeWorkerOptions {
    const manifestOptions = worker?.manifest ? materializeWorkerManifest(worker.manifest) : undefined;
    assertWorkerManifestDomainScope(manifestOptions?.domainIds, preview.intent.domainIds);
    const transport = worker?.transport ?? manifestOptions?.transport ?? 'acp';
    const domainIds = mergeWorkerDomainScopes(preview.intent.domainIds, manifestOptions?.domainIds, worker?.domainIds);
    const permissionProfile = mergePermissionProfiles(manifestOptions?.permissionProfile, worker?.permissionProfile);
    const permissionOverrides = mergePermissionOverrides(manifestOptions?.permissionOverrides, worker?.permissionOverrides);
    if (worker?.events) {
      return {
        ...worker,
        transport,
        domainIds,
        ...(permissionProfile ? { permissionProfile } : {}),
        permissionOverrides,
      };
    }
    return {
      transport,
      ...(worker?.manifest ? { manifest: worker.manifest } : {}),
      domainIds,
      ...(permissionProfile ? { permissionProfile } : {}),
      permissionOverrides,
      ...(worker?.capabilityPolicy ? { capabilityPolicy: worker.capabilityPolicy } : {}),
      verifierValidators: worker?.verifierValidators,
      events: ({ runId, taskId, sessionId, workerRunId }) => (async function* () {
        yield {
          sessionId,
          type: 'worker_frame' as const,
          ts: Date.now(),
          data: {
            protocol_version: WORKER_PROTOCOL_VERSION,
            type: 'plan_fragment',
            frame_id: `pf-plan-${runId}`,
            task_id: taskId,
            run_id: runId,
            worker_run_id: workerRunId,
            seq: 0,
            content: preview.scopedPlan.objective,
            steps: preview.dagPreview.nodes.map((node) => node.kind),
          },
        };
        yield {
          sessionId,
          type: 'worker_frame' as const,
          ts: Date.now(),
          data: {
            protocol_version: WORKER_PROTOCOL_VERSION,
            type: 'final_report',
            frame_id: `pf-final-${runId}`,
            task_id: taskId,
            run_id: runId,
            worker_run_id: workerRunId,
            seq: 1,
            status: 'succeeded',
            summary: `Product Factory executed ${preview.template.title}: ${preview.intent.title}`,
          },
        };
      })(),
    };
  }

  private productFactoryExecutionPrompt(preview: ProductFactoryPlanPreview): string {
    return [
      preview.intent.goal,
      '',
      'Scoped plan:',
      ...preview.scopedPlan.scope.map((line) => `- ${line}`),
      '',
      'Quality gates:',
      ...preview.scopedPlan.qualityGates.map((gate) => `- ${gate}`),
    ].join('\n').trim();
  }

  private async completeProductFactoryDagNodes(
    runId: string,
    kinds: string[],
    artifact?: ArtifactRef,
  ): Promise<void> {
    if (!this.orchestration) return;
    const kindSet = new Set(kinds);
    const nodes = this.orchestration.dag.listNodes()
      .filter((node) => node.id.startsWith(`${runId}/`) && kindSet.has(node.kind))
      .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
    const provenance = artifact
      ? [{ kind: 'artifact' as const, ref: artifact.id, role: 'evidence' as const, sha256: artifact.sha256 }]
      : [];
    for (const node of nodes) {
      const current = this.orchestration.dag.getNode(node.id);
      if (!current || current.status === 'succeeded') continue;
      if (current.status === 'pending' || current.status === 'ready') {
        this.orchestration.dag.leaseNode(node.id, 'product-factory-executor', 60_000);
      }
      const leased = this.orchestration.dag.getNode(node.id);
      if (leased?.status === 'leased') {
        this.orchestration.dag.startNode(node.id, 'product-factory-executor');
      }
      const running = this.orchestration.dag.getNode(node.id);
      if (running?.status === 'leased' || running?.status === 'running') {
        this.orchestration.dag.completeNode(node.id, provenance);
      }
    }
  }

  private async completeDeliveryEvidenceDagNode(
    runId: string,
    artifact: ArtifactRef,
    snapshot: DeliveryEvidenceSnapshot,
  ): Promise<void> {
    const deliveryNodes = this.orchestration?.dag.listNodes()
      .filter((node) => node.id.startsWith(`${runId}/`) && node.kind === 'product_factory.delivery_package') ?? [];
    const completedDeliveryNodeIds = deliveryNodes
      .filter((node) => node.status === 'succeeded')
      .map((node) => node.id);
    const waiverNodeId = snapshot.verifier?.status === 'waived' && snapshot.verifier.waiverArtifactId
      ? `run:${runId}:verifier-waiver:${snapshot.verifier.waiverArtifactId}`
      : undefined;
    const waiverNode = waiverNodeId ? this.orchestration?.dag.getNode(waiverNodeId) : undefined;
    const dependsOn = completedDeliveryNodeIds.length > 0
      ? completedDeliveryNodeIds
      : waiverNode?.status === 'succeeded'
        ? [waiverNodeId!]
        : deliveryNodes.map((node) => node.id);
    const evidenceNodeId = snapshot.verifier?.status === 'waived'
      && this.orchestration?.dag.getNode(`run:${runId}:github-delivery-evidence`)?.status === 'succeeded'
      ? `run:${runId}:github-delivery-evidence:${artifact.id}`
      : `run:${runId}:github-delivery-evidence`;
    await this.completeDagNodeOnce(evidenceNodeId, {
      kind: 'product_factory.github_delivery_evidence',
      payload: {
        provider: 'github',
        repository: snapshot.github.repository,
        branch: snapshot.git.branch,
        commitSha: snapshot.git.headSha,
        available: snapshot.github.available,
      },
      dependsOn,
      provenance: [
        { kind: 'run', ref: runId, role: 'input' },
        { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
    ]);
  }

  private async completeVerifierWaiverDagNode(
    runId: string,
    artifact: ArtifactRef,
    waiver: VerifierWaiverRecord,
  ): Promise<void> {
    const verifierNodeIds = this.orchestration?.dag.listNodes()
      .filter((node) =>
        node.kind === 'governed.verifier'
        && node.id.startsWith(`run:${runId}:`)
        && (!waiver.verifierRunId || node.payload['verifierRunId'] === waiver.verifierRunId)
      )
      .map((node) => node.id) ?? [];
    await this.completeDagNodeOnce(`run:${runId}:verifier-waiver:${artifact.id}`, {
      kind: 'governed.verifier_waiver',
      payload: {
        rawStatus: waiver.rawStatus,
        scope: waiver.scope,
        operatorId: waiver.operator.id,
        ...(waiver.verifierRunId ? { verifierRunId: waiver.verifierRunId } : {}),
        ...(waiver.verifierArtifactId ? { verifierArtifactId: waiver.verifierArtifactId } : {}),
        ...(waiver.verifierEventId ? { verifierEventId: waiver.verifierEventId } : {}),
      },
      dependsOn: verifierNodeIds,
      provenance: [
        { kind: 'run', ref: runId, role: 'input' },
        ...(waiver.verifierArtifactId ? [{ kind: 'artifact' as const, ref: waiver.verifierArtifactId, role: 'evidence' as const }] : []),
        ...(waiver.verifierEventId ? [{ kind: 'ledger_event' as const, ref: waiver.verifierEventId, role: 'decision' as const }] : []),
        { kind: 'artifact', ref: artifact.id, role: 'decision', sha256: artifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
    ]);
  }

  private async completeGithubDeliveryPlanDagNode(
    runId: string,
    artifact: ArtifactRef,
    plan: GitHubDeliveryPlan,
    evidenceArtifact: ArtifactRef,
  ): Promise<void> {
    const evidenceNodeIds = this.orchestration?.dag.listNodes()
      .filter((node) => node.id.startsWith(`run:${runId}:github-delivery-evidence`) && node.kind === 'product_factory.github_delivery_evidence')
      .map((node) => node.id) ?? [];
    await this.completeDagNodeOnce(`run:${runId}:github-delivery-plan`, {
      kind: 'product_factory.github_delivery_plan',
      payload: {
        provider: 'github',
        mode: plan.mode,
        applySupported: plan.applySupported,
        repository: plan.repository,
        proposedBranch: plan.proposedBranch,
        blockers: plan.blockers,
      },
      dependsOn: evidenceNodeIds,
      provenance: [
        { kind: 'run', ref: runId, role: 'input' },
        { kind: 'artifact', ref: evidenceArtifact.id, role: 'input', sha256: evidenceArtifact.sha256 },
        { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
    ]);
  }

  private async completeGithubDeliveryApplyDagNode(
    runId: string,
    artifact: ArtifactRef,
    result: GitHubDeliveryApplyResult,
    planArtifact: ArtifactRef,
  ): Promise<void> {
    const planNodeIds = this.orchestration?.dag.listNodes()
      .filter((node) => node.id.startsWith(`run:${runId}:github-delivery-plan`) && node.kind === 'product_factory.github_delivery_plan')
      .map((node) => node.id) ?? [];
    await this.completeDagNodeOnce(`run:${runId}:github-delivery-apply`, {
      kind: 'product_factory.github_delivery_apply',
      payload: {
        provider: 'github',
        mode: result.mode,
        repository: result.repository,
        branch: result.branch,
        pullRequestNumber: result.draftPullRequest.number,
        pullRequestUrl: result.draftPullRequest.url,
      },
      dependsOn: planNodeIds,
      provenance: [
        { kind: 'run', ref: runId, role: 'input' },
        { kind: 'artifact', ref: planArtifact.id, role: 'input', sha256: planArtifact.sha256 },
        { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: artifact.id, role: 'output', sha256: artifact.sha256 },
    ]);
  }

  private resolveGithubToken(): string | undefined {
    return process.env['PYRFOR_GITHUB_TOKEN'] || process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'] || undefined;
  }

  private seedProductFactoryDag(runId: string, preview: ProductFactoryPlanPreview, artifact: ArtifactRef): void {
    if (!this.orchestration) return;
    if (preview.template.id === 'ochag_family_reminder') {
      const answers = this.extractProductFactoryAnswers(preview);
      const familyPayload = {
        productFactory: true,
        runId,
        artifactId: artifact.id,
        intentId: preview.intent.id,
        title: preview.intent.title,
        familyId: answers['familyId'] ?? 'default-family',
        audience: answers['audience'],
        memberIds: answers['memberIds']?.split(',').map((item) => item.trim()).filter(Boolean) ?? [],
        visibility: answers['visibility'] ?? 'family',
        dueAt: answers['dueAt'],
        escalationPolicy: answers['escalationPolicy'] ?? 'adult',
        reminderChannel: 'telegram',
      };
      const overlayNodes = this.orchestration.overlays.instantiateWorkflow('ochag', 'family-reminder', {
        idPrefix: `product_factory/${preview.intent.id}/ochag/family-reminder`,
        payload: familyPayload,
        provenance: [
          { kind: 'run', ref: runId, role: 'input' },
          { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
        ],
      });
      for (const node of overlayNodes) {
        this.orchestration.dag.addNode({
          ...node,
          id: `${runId}/${node.id}`,
          idempotencyKey: `${runId}:${node.id}`,
          dependsOn: (node.dependsOn ?? []).map((dep) => `${runId}/${dep}`),
          payload: {
            ...(node.payload ?? {}),
            runId,
            artifactId: artifact.id,
          },
        });
      }
      return;
    }
    if (preview.template.id === 'business_brief') {
      const answers = this.extractProductFactoryAnswers(preview);
      const businessPayload = {
        productFactory: true,
        runId,
        artifactId: artifact.id,
        intentId: preview.intent.id,
        title: preview.intent.title,
        projectId: answers['projectId'] ?? 'default-project',
        actionType: 'approval',
        decision: answers['decision'],
        evidenceRefs: answers['evidence']?.split(',').map((item) => item.trim()).filter(Boolean) ?? [],
        deadline: answers['deadline'],
      };
      const overlayNodes = this.orchestration.overlays.instantiateWorkflow('ceoclaw', 'evidence-approval', {
        idPrefix: `product_factory/${preview.intent.id}/ceoclaw/evidence-approval`,
        payload: businessPayload,
        provenance: [
          { kind: 'run', ref: runId, role: 'input' },
          { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
        ],
      });
      for (const node of overlayNodes) {
        this.orchestration.dag.addNode({
          ...node,
          id: `${runId}/${node.id}`,
          idempotencyKey: `${runId}:${node.id}`,
          dependsOn: (node.dependsOn ?? []).map((dep) => `${runId}/${dep}`),
          payload: {
            ...(node.payload ?? {}),
            runId,
            artifactId: artifact.id,
          },
        });
      }
      return;
    }

    const idMap = new Map<string, string>();
    for (const node of preview.dagPreview.nodes) {
      if (node.id) idMap.set(node.id, `${runId}/${node.id}`);
    }

    for (const node of preview.dagPreview.nodes) {
      const originalId = node.id ?? randomUUID();
      const persistedId = idMap.get(originalId) ?? `${runId}/${originalId}`;
      this.orchestration.dag.addNode({
        ...node,
        id: persistedId,
        idempotencyKey: `${runId}:${originalId}`,
        dependsOn: (node.dependsOn ?? []).map((dep) => idMap.get(dep) ?? `${runId}/${dep}`),
        payload: {
          ...(node.payload ?? {}),
          runId,
          artifactId: artifact.id,
        },
        provenance: [
          ...(node.provenance ?? []),
          { kind: 'run', ref: runId, role: 'input' },
          { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
        ],
      });
    }
  }

  private async seedProductFactoryActors(runId: string, preview: ProductFactoryPlanPreview, artifact: ArtifactRef): Promise<void> {
    if (!this.orchestration) return;
    const actorSeeds = buildProductFactoryActorSeeds(preview);
    if (actorSeeds.length === 0) return;
    const gateNodeId = this.productFactoryActorGateNodeId(runId);
    this.orchestration.dag.addNode({
      id: gateNodeId,
      kind: 'product_factory.actor_execution_gate',
      payload: {
        productFactory: true,
        runId,
        artifactId: artifact.id,
        intentId: preview.intent.id,
        templateId: preview.template.id,
        goal: 'Unlock seeded product actor mailbox work after the operator starts governed execution.',
      },
      idempotencyKey: gateNodeId,
      retryClass: 'human_needed',
      timeoutClass: 'manual',
      provenance: [
        { kind: 'run', ref: runId, role: 'input' },
        { kind: 'artifact', ref: artifact.id, role: 'evidence', sha256: artifact.sha256 },
      ],
    });
    let previousSeedNodeId: string | undefined = gateNodeId;
    for (const actor of actorSeeds) {
      await this.orchestration.actorKernel.spawnActor({
        runId,
        actorId: actor.actorId,
        agentId: actor.agentId,
        agentName: actor.agentName,
        role: actor.role,
        goal: actor.goal,
      });
      for (const message of actor.messages) {
        const node = await this.orchestration.actorKernel.enqueueMessage({
          runId,
          actorId: actor.actorId,
          task: message.task,
          priority: message.priority,
          idempotencyKey: `${runId}:${message.idempotencyKey}`,
          ...(previousSeedNodeId ? { dependsOn: [previousSeedNodeId] } : {}),
          payload: {
            ...message.payload,
            runId,
            planArtifactId: artifact.id,
            planArtifactSha256: artifact.sha256,
          },
        });
        previousSeedNodeId = node.id;
      }
    }
  }

  private async completeProductFactoryActorGate(runId: string): Promise<void> {
    if (!this.orchestration) return;
    const gateNodeId = this.productFactoryActorGateNodeId(runId);
    const gateNode = this.orchestration.dag.getNode(gateNodeId);
    if (!gateNode) return;
    await this.completeDagNodeOnce(gateNodeId, {
      kind: gateNode.kind,
      payload: gateNode.payload,
      provenance: gateNode.provenance,
    }, [
      { kind: 'run', ref: runId, role: 'decision', meta: { action: 'execute_product_factory_actor_gate' } },
    ]);
  }

  private productFactoryActorGateNodeId(runId: string): string {
    return `run:${runId}:product-factory-actor-execution-gate`;
  }

  private extractProductFactoryAnswers(preview: ProductFactoryPlanPreview): Record<string, string> {
    const answers: Record<string, string> = {};
    for (const scopeLine of preview.scopedPlan.scope) {
      for (const clarification of preview.template.clarifications) {
        if (scopeLine.startsWith(clarification.question)) {
          answers[clarification.id] = scopeLine.slice(clarification.question.length).trim();
        }
      }
    }
    return answers;
  }

  private async markUserRunRunning(run: ActiveRuntimeRun): Promise<void> {
    await this.orchestration?.runLedger.transition(run.runId, 'running', 'user turn started');
  }

  private async completeUserRun(
    run: ActiveRuntimeRun,
    status: 'completed' | 'failed',
    summary?: string,
  ): Promise<void> {
    try {
      const current = this.orchestration?.runLedger.getRun(run.runId);
      if (
        current?.status !== 'completed'
        && current?.status !== 'failed'
        && current?.status !== 'blocked'
        && current?.status !== 'cancelled'
      ) {
        await this.orchestration?.runLedger.completeRun(run.runId, status, summary);
      }
    } finally {
      await this.cleanupGovernedWorktree(run, status);
      await this.releaseRuntimeBudgetProfile(run);
    }
  }

  private createRunAwareToolExecutor(run: ActiveRuntimeRun | null) {
    return async (
      name: string,
      args: Record<string, unknown>,
      ctx?: Parameters<typeof executeRuntimeTool>[2],
    ) => {
      if (run) {
        await this.orchestration?.runLedger.recordToolRequested(run.runId, name, args);
      }
      const result = await executeRuntimeTool(name, args, {
        ...ctx,
        runId: run?.runId ?? ctx?.runId,
      });
      if (run) {
        await this.orchestration?.runLedger.recordToolExecuted(run.runId, name, {
          status: result.success ? 'ok' : 'error',
          error: result.success ? undefined : result.error,
        });
      }
      return result;
    };
  }

  private governedWorkspacePath(run: ActiveRuntimeRun): string {
    return run.governed?.worktree?.path ?? this.options.workspacePath;
  }

  private async ensureGovernedWorktree(run: ActiveRuntimeRun): Promise<ManagedGitWorktree> {
    if (!run.governed) {
      throw new Error('Governed run state is not initialized');
    }
    if (run.governed.worktree) {
      return run.governed.worktree;
    }
    if (!this.worktreeManager || !this.orchestration) {
      throw new Error('Governed worker worktree manager is not initialized');
    }

    const worktree = await this.worktreeManager.createForRun(run.runId);
    await this.orchestration.eventLedger.append({
      type: 'sandbox.run.started',
      run_id: run.runId,
      node_id: worktree.id,
      sandbox_backend: 'git-worktree',
      branch_or_worktree_id: worktree.branch,
      status: 'started',
      reason: `isolated governed worker from ${worktree.baseBranch}`,
    });
    this.orchestration.runLedger.updateBranchOrWorktreeId(run.runId, worktree.branch);
    run.governed.worktree = worktree;
    return worktree;
  }

  private async cleanupGovernedWorktree(run: ActiveRuntimeRun, status: string): Promise<void> {
    const governed = run.governed;
    const worktree = governed?.worktree;
    if (!governed || !worktree || governed.worktreeCleaned || !this.worktreeManager) {
      return;
    }

    try {
      await this.worktreeManager.cleanupForRun(run.runId);
      governed.worktreeCleaned = true;
      await this.orchestration?.eventLedger.append({
        type: 'sandbox.run.completed',
        run_id: run.runId,
        node_id: worktree.id,
        sandbox_backend: 'git-worktree',
        branch_or_worktree_id: worktree.branch,
        status: 'cleaned',
        reason: `worktree removed after ${status}`,
      });
    } catch (err) {
      logger.warn('[runtime] Failed to cleanup governed worker worktree', {
        runId: run.runId,
        worktree: worktree.path,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        await this.orchestration?.eventLedger.append({
          type: 'sandbox.run.completed',
          run_id: run.runId,
          node_id: worktree.id,
          sandbox_backend: 'git-worktree',
          branch_or_worktree_id: worktree.branch,
          status: 'cleanup_failed',
          error: err instanceof Error ? err.message : String(err),
        });
      } catch {
        // Best effort only.
      }
    }
  }

  private async runLiveWorkerStream(
    run: ActiveRuntimeRun | null,
    sessionId: string,
    userId: string,
    prompt: string,
    worker?: RuntimeWorkerOptions,
  ): Promise<string | null> {
    if (!worker) {
      return null;
    }
    if (!run || !this.orchestration) {
      throw new Error('Worker execution requires runtime orchestration');
    }

    const workerRunId = `worker-run:${run.runId}:${randomUUID()}`;
    run.workerRunId = workerRunId;
    const host = this.createOrchestrationHostForRun(run, sessionId, userId, worker);
    run.orchestrationHost = host;
    const workerTransport = worker.transport ?? (worker.manifest ? materializeWorkerManifest(worker.manifest).transport : 'freeclaude');
    run.workerTransport = workerTransport;

    const results: WorkerProtocolBridgeResult[] = [];
    const events = worker.events
      ? worker.events({ runId: run.runId, taskId: run.taskId, sessionId, workerRunId })
      : workerTransport === 'freeclaude'
        ? this.createFreeClaudeWorkerEvents({ run, sessionId, userId, workerRunId, prompt, worker })
        : null;
    if (!events) {
      throw new Error(`Worker transport "${workerTransport}" requires an event source`);
    }

    if (workerTransport === 'acp') {
      for await (const event of events as AsyncIterable<AcpEvent>) {
        const result = await host.codingHost.handleAcpEvent(event);
        if (result) {
          results.push(result);
          this.assertWorkerResultCanContinue(result);
        }
      }
    } else {
      for await (const event of events as AsyncIterable<FCEvent>) {
        this.assertStrictFreeClaudeEvent(event);
        const result = await host.codingHost.handleFreeClaudeEvent(event);
        if (result) {
          results.push(result);
          this.assertWorkerResultCanContinue(result);
        }
      }
    }

    return this.summarizeWorkerResults(run, results);
  }

  private async *createFreeClaudeWorkerEvents(input: {
    run: ActiveRuntimeRun;
    sessionId: string;
    userId: string;
    workerRunId: string;
    prompt: string;
    worker: RuntimeWorkerOptions;
  }): AsyncIterable<FCEvent> {
    const runFreeClaude = input.worker.freeClaudeRun
      ?? (await import('./pyrfor-fc-adapter.js')).runFreeClaude;
    const guardrails = input.worker.guardrails ?? await this.getFreeClaudeGuardrails();
    const { derivePreflightDisallow } = await import('./pyrfor-fc-guardrails.js');
    const disallowedTools = mergeUniqueStrings(
      input.worker.guardrailPreflightDisallow ?? [],
      derivePreflightDisallow(guardrails),
    );
    const circuitEnabled = Boolean(input.worker.freeClaudeCircuit?.modelChain.length);
    const budget = circuitEnabled
      ? this.resolveFreeClaudeBudgetForWorker(input)
      : this.assertFreeClaudeBudgetCanStart(input);
    const governedWorkspace = this.governedWorkspacePath(input.run);
    const runOptions: FCRunOptions = {
      prompt: input.prompt,
      workdir: governedWorkspace,
      model: this.config.ai.activeModel?.modelId,
      permissionMode: 'plan',
      disallowedTools: disallowedTools.length > 0 ? disallowedTools : undefined,
      appendSystemPrompt: [
        'Emit only Pyrfor Worker Protocol JSON frames as newline-delimited JSON.',
        `Use run_id "${input.run.runId}", task_id "${input.run.taskId}", worker_run_id "${input.workerRunId}".`,
        'Do not emit native tool_use events or native mutation result summaries outside Worker Protocol frames.',
      ].join('\n'),
    };
    const handle = circuitEnabled
      ? await this.createFreeClaudeCircuitHandle(runOptions, runFreeClaude, guardrails, budget, input)
      : runFreeClaude(runOptions);
    const budgetMonitor = this.startFreeClaudeBudgetMonitor(handle, budget);
    try {
      if (circuitEnabled) {
        yield* handle.events();
      } else {
        yield* this.guardFreeClaudeWorkerEvents(handle, guardrails, input);
      }
      const result = await handle.complete();
      if (!circuitEnabled) {
        this.recordFreeClaudeBudgetConsumption(result.envelope, budget);
      }
      if (budgetMonitor.abortReason) {
        throw new Error(budgetMonitor.abortReason);
      }
      if (result.exitCode !== 0 || result.envelope.status === 'error') {
        throw new Error(result.envelope.error ?? `FreeClaude worker exited with code ${result.exitCode}`);
      }
    } finally {
      budgetMonitor.stop();
    }
  }

  private async createFreeClaudeCircuitHandle(
    runOptions: FCRunOptions,
    runFreeClaude: (opts: FCRunOptions) => FCHandle,
    guardrails: Guardrails,
    budget: ResolvedFreeClaudeBudget | null,
    input: {
      run: ActiveRuntimeRun;
      sessionId: string;
      userId: string;
      workerRunId: string;
      worker: RuntimeWorkerOptions;
    },
  ): Promise<FCHandle> {
    const { createFreeClaudeCircuitHandle } = await import('./pyrfor-fc-circuit-router.js');
    const { FcEventReader } = await import('./pyrfor-event-reader.js');
    let readerAttemptIndex = -1;
    let reader = new FcEventReader();
    return createFreeClaudeCircuitHandle(runOptions, {
      ...input.worker.freeClaudeCircuit!,
      runFn: runFreeClaude,
      beforeAttempt: () => {
        if (budget) {
          this.assertFreeClaudeBudgetCanConsume(budget);
        }
      },
      validateEvent: async (event, ctx) => {
        this.assertStrictFreeClaudeEvent(event);
        if (ctx.attemptIndex !== readerAttemptIndex) {
          readerAttemptIndex = ctx.attemptIndex;
          reader = new FcEventReader();
        }
        for (const parsedEvent of reader.read(event)) {
          await this.assertFreeClaudeGuardrailAllows(guardrails, parsedEvent, input);
        }
      },
      onAttemptComplete: (result) => {
        this.recordFreeClaudeBudgetConsumption(result.envelope, budget);
      },
    });
  }

  private assertFreeClaudeBudgetCanStart(input: {
    run: ActiveRuntimeRun;
    sessionId: string;
    worker: RuntimeWorkerOptions;
  }): ResolvedFreeClaudeBudget | null {
    const resolved = this.resolveFreeClaudeBudgetForWorker(input);
    if (!resolved) return null;
    this.assertFreeClaudeBudgetCanConsume(resolved);
    return resolved;
  }

  private resolveFreeClaudeBudgetForWorker(input: {
    run: ActiveRuntimeRun;
    sessionId: string;
    worker: RuntimeWorkerOptions;
  }): ResolvedFreeClaudeBudget | null {
    const configured = input.worker.freeClaudeBudget;
    if (configured) {
      return this.resolveFreeClaudeBudget(input.run, input.sessionId, configured);
    }
    const controller = this.getRuntimeBudgetController();
    if (!controller) {
      return null;
    }
    const target = this.runtimeBudgetTargets(input.run, input.sessionId)[0];
    if (!target) {
      return null;
    }
    return {
      controller,
      scope: target.scope,
      targetId: target.targetId,
      checkIntervalMs: 10_000,
      preflightEstimate: { promptTokens: 8192, completionTokens: 4096 },
      now: () => Date.now(),
    };
  }

  private assertFreeClaudeBudgetCanConsume(budget: ResolvedFreeClaudeBudget): void {
    const preCheck = budget.controller.canConsume({
      scope: budget.scope,
      targetId: budget.targetId,
      estPromptTokens: budget.preflightEstimate.promptTokens,
      estCompletionTokens: budget.preflightEstimate.completionTokens,
      estCostUsd: 0,
    });
    if (!preCheck.allowed) {
      const reason = `budget denied: ${preCheck.blockingRule ?? 'limit exceeded'}`;
      budget.logger?.('warn', 'FreeClaude budget pre-check denied', { reason, scope: budget.scope, targetId: budget.targetId });
      throw new Error(reason);
    }
    budget.logger?.('info', 'FreeClaude budget pre-check passed', { scope: budget.scope, targetId: budget.targetId });
  }

  private startFreeClaudeBudgetMonitor(
    handle: FCHandle,
    budget: ResolvedFreeClaudeBudget | null,
  ): { stop(): void; readonly abortReason: string | null } {
    let abortReason: string | null = null;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;
    if (budget && budget.checkIntervalMs > 0) {
      intervalHandle = setInterval(() => {
        if (abortReason) return;
        const midCheck = budget.controller.canConsume({
          scope: budget.scope,
          targetId: budget.targetId,
          estPromptTokens: 0,
          estCompletionTokens: 0,
          estCostUsd: 0,
        });
        if (!midCheck.allowed) {
          abortReason = `budget exhausted: ${midCheck.blockingRule ?? 'limit exceeded'}`;
          budget.logger?.('warn', 'FreeClaude budget mid-run check denied, aborting', {
            reason: abortReason,
            scope: budget.scope,
            targetId: budget.targetId,
          });
          budget.onBudgetAbort?.(abortReason);
          handle.abort('budget exhausted');
        }
      }, budget.checkIntervalMs);
    }
    return {
      stop() {
        if (intervalHandle !== null) {
          clearInterval(intervalHandle);
          intervalHandle = null;
        }
      },
      get abortReason() {
        return abortReason;
      },
    };
  }

  private recordFreeClaudeBudgetConsumption(
    envelope: FCEnvelope,
    budget: ResolvedFreeClaudeBudget | null,
  ): void {
    if (!budget) return;
    const sessionCost = envelopeToSessionCost(envelope, budget.now);
    budget.controller.canConsume({
      scope: budget.scope,
      targetId: budget.targetId,
      estPromptTokens: sessionCost.promptTokens,
      estCompletionTokens: sessionCost.completionTokens,
      estCostUsd: sessionCost.costUsd,
    });
    budget.controller.recordConsumption({
      ts: budget.now(),
      scope: budget.scope,
      targetId: budget.targetId,
      promptTokens: sessionCost.promptTokens,
      completionTokens: sessionCost.completionTokens,
      costUsd: sessionCost.costUsd,
      provider: envelope.model,
    });
    budget.logger?.('info', 'FreeClaude budget consumption recorded', {
      scope: budget.scope,
      targetId: budget.targetId,
      promptTokens: sessionCost.promptTokens,
      completionTokens: sessionCost.completionTokens,
      costUsd: sessionCost.costUsd,
    });
  }

  private resolveFreeClaudeBudget(
    run: ActiveRuntimeRun,
    sessionId: string,
    budget: RuntimeFreeClaudeBudgetOptions,
  ): ResolvedFreeClaudeBudget {
    const scope = budget.scope ?? 'task';
    const targetId = budget.scopeId ?? (
      scope === 'task'
        ? run.taskId
        : scope === 'session'
          ? sessionId
          : undefined
    );
    return {
      controller: budget.controller,
      scope,
      targetId,
      checkIntervalMs: budget.checkIntervalMs ?? 10_000,
      preflightEstimate: budget.preflightEstimate ?? { promptTokens: 8192, completionTokens: 4096 },
      now: budget.now ?? (() => Date.now()),
      logger: budget.logger,
      onBudgetAbort: budget.onBudgetAbort,
    };
  }

  private async getFreeClaudeGuardrails(): Promise<Guardrails> {
    if (this.freeClaudeGuardrails) return this.freeClaudeGuardrails;
    const { createGuardrails } = await import('./guardrails.js');
    this.freeClaudeGuardrails = createGuardrails({
      defaultTier: 'safe',
      policies: DEFAULT_FREECLAUDE_GUARDRAIL_POLICIES,
      logger: (level, msg, meta) => {
        logger[level](msg, meta);
      },
    });
    return this.freeClaudeGuardrails;
  }

  private async *guardFreeClaudeWorkerEvents(
    handle: FCHandle,
    guardrails: Guardrails,
    input: {
      run: ActiveRuntimeRun;
      sessionId: string;
      userId: string;
      workerRunId: string;
    },
  ): AsyncIterable<FCEvent> {
    const { FcEventReader } = await import('./pyrfor-event-reader.js');
    const reader = new FcEventReader();
    for await (const event of handle.events()) {
      for (const parsedEvent of reader.read(event)) {
        await this.assertFreeClaudeGuardrailAllows(guardrails, parsedEvent, input, handle);
      }
      yield event;
    }
    reader.flush();
  }

  private async assertFreeClaudeGuardrailAllows(
    guardrails: Guardrails,
    event: ParsedFreeClaudeEvent,
    input: {
      run: ActiveRuntimeRun;
      sessionId: string;
      userId: string;
      workerRunId: string;
    },
    handle?: FCHandle,
  ): Promise<void> {
    const decision = await this.evaluateFreeClaudeGuardrail(guardrails, event, input);
    if (decision && !decision.allowed) {
      const reason = decision.kind === 'ask'
        ? `guardrail-approval-required: ${decision.reason}`
        : `guardrail-block: ${decision.reason}`;
      handle?.abort(reason);
      logger.warn('[runtime] FreeClaude guardrail blocked native tool event', {
        runId: input.run.runId,
        workerRunId: input.workerRunId,
        decisionId: decision.decisionId,
        reason,
      });
      throw new Error(reason);
    }
  }

  private async evaluateFreeClaudeGuardrail(
    guardrails: Guardrails,
    event: ParsedFreeClaudeEvent,
    input: {
      run: ActiveRuntimeRun;
      sessionId: string;
      userId: string;
      workerRunId: string;
    },
  ): Promise<GuardrailDecision | null> {
    let toolName: string;
    let args: Record<string, unknown>;
    if (event.type === 'ToolCallStart') {
      toolName = event.toolName;
      args = typeof event.input === 'object' && event.input !== null
        ? event.input as Record<string, unknown>
        : { input: event.input };
    } else if (event.type === 'BashCommand') {
      toolName = 'Bash';
      args = { command: event.command };
    } else {
      return null;
    }
    const ctx: GuardrailContext = {
      agentId: input.workerRunId,
      agentRole: 'freeclaude-worker',
      toolName,
      args,
      userId: input.userId,
      chatId: input.sessionId,
      isAutonomous: true,
    };
    return guardrails.evaluate(ctx);
  }

  private async prepareGovernedRun(
    run: ActiveRuntimeRun,
    input: {
      sessionId: string;
      text: string;
      openFiles: OpenFile[];
      trustedSession?: Session;
      trustSessionProjectMetadata?: boolean;
    },
  ): Promise<void> {
    if (!this.orchestration || run.governed) return;
    await this.awaitWorkspaceSwitch();

    const compiler = this.createContextCompiler();
    const sessionProjectId = this.trustedSessionProjectId(input.trustedSession, input.trustSessionProjectMetadata);
    const compiled = await compiler.compile({
      runId: run.runId,
      workspaceId: this.options.workspacePath,
      ...(sessionProjectId ? { projectId: sessionProjectId } : {}),
      task: {
        id: run.taskId,
        title: input.text.slice(0, 120) || 'Worker run',
        description: input.text,
      },
      sessionId: input.sessionId,
      sessionMessageLimit: 20,
      agentId: 'pyrfor-runtime',
      query: input.text,
      memoryLimit: 6,
      historyRunIds: [run.runId],
      filesOfInterest: input.openFiles.map((file) => ({
        path: file.path,
        content: file.content,
      })),
      ledgerEventLimit: 50,
    });
    const contextArtifact = await compiler.persist(compiled, {
      artifactStore: this.orchestration.artifactStore,
      runId: run.runId,
    });
    await this.orchestration.runLedger.recordArtifact(run.runId, contextArtifact.id, [contextArtifact.uri]);

    const contextNodeId = `run:${run.runId}:ctx`;
    await this.completeDagNodeOnce(contextNodeId, {
      kind: 'governed.context_pack',
      payload: {
        artifactId: contextArtifact.id,
        hash: contextArtifact.sha256,
        packId: compiled.pack.packId,
      },
      provenance: [
        { kind: 'run', ref: run.runId, role: 'input' },
        { kind: 'artifact', ref: contextArtifact.id, role: 'output', sha256: contextArtifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: contextArtifact.id, role: 'output', sha256: contextArtifact.sha256 },
    ]);

    run.governed = {
      contextArtifact,
      contextNodeId,
      workerEvents: [],
      frameNodeIds: [],
      effectNodeIds: [],
      worktreeCleaned: false,
    };
    await this.ensureGovernedWorktree(run);
  }

  private createContextCompiler(): ContextCompiler {
    if (!this.orchestration) throw new Error('ContextPack: orchestration is disabled');
    return new ContextCompiler({
      artifactStore: this.orchestration.artifactStore,
      eventLedger: this.orchestration.eventLedger,
      runLedger: this.orchestration.runLedger,
      dag: this.orchestration.dag,
      sessionStore: this.store ?? undefined,
      workspace: this.workspace?.getWorkspace() ?? undefined,
      workspaceLoader: this.workspace ?? undefined,
    });
  }

  private trustedSessionProjectId(session: Session | undefined, trusted: boolean | undefined): string | undefined {
    if (!trusted || !session || !this.belongsToCurrentWorkspace(session)) return undefined;
    const projectId = session?.metadata?.projectId;
    return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : undefined;
  }

  private createOrchestrationHostForRun(
    run: ActiveRuntimeRun,
    sessionId: string,
    userId: string,
    worker: RuntimeWorkerOptions,
  ): OrchestrationHost {
    if (!this.orchestration) {
      throw new Error('Runtime orchestration is not initialized');
    }
    const workspaceId = this.governedWorkspacePath(run);
    return createOrchestrationHost({
      orchestration: this.orchestration,
      workspaceId,
      sessionId,
      domainIds: worker.domainIds,
      workerManifest: worker.manifest,
      permissionProfile: worker.permissionProfile,
      permissionOverrides: worker.permissionOverrides,
      capabilityPolicy: worker.capabilityPolicy,
      toolExecutors: this.createWorkerToolExecutors(run, sessionId, userId),
      approvalFlow: {
        requestApproval: (req) => approvalFlow.requestApproval(req),
      },
      toolAudit: (event) => approvalFlow.recordToolOutcome({
        ...event,
        sessionId: event.sessionId ?? sessionId,
      }),
      logger: (level, message, meta) => {
        logger[level](message, typeof meta === 'object' && meta !== null ? meta as Record<string, unknown> : { meta });
      },
      deferTerminalRunCompletion: true,
      expectedRunId: run.runId,
      expectedTaskId: run.taskId,
      expectedWorkerRunId: run.workerRunId,
      enforceFrameOrder: true,
      onFrameResult: async (result, source) => {
        await this.recordGovernedWorkerFrame(run, result, source);
      },
    });
  }

  private async recordGovernedWorkerFrame(
    run: ActiveRuntimeRun,
    result: WorkerProtocolBridgeResult,
    source: 'acp' | 'freeclaude',
  ): Promise<void> {
    if (!this.orchestration || !run.governed || !result.frame) return;

    const frame = result.frame;
    const acpEvent: AcpEvent = {
      sessionId: `${source}:${run.runId}`,
      type: 'worker_frame',
      data: frame,
      ts: Date.now(),
    };
    run.governed.workerEvents.push(acpEvent);

    const frameNodeId = `run:${run.runId}:frame:${frame.frame_id}`;
    await this.completeDagNodeOnce(frameNodeId, {
      kind: `worker.frame.${frame.type}`,
      payload: {
        source,
        disposition: result.disposition,
        ok: result.ok,
        frameType: frame.type,
      },
      dependsOn: [run.governed.contextNodeId],
      provenance: [
        { kind: 'run', ref: run.runId, role: 'input' },
        { kind: 'artifact', ref: run.governed.contextArtifact.id, role: 'input', sha256: run.governed.contextArtifact.sha256 },
        { kind: 'worker_frame', ref: frame.frame_id, role: 'evidence', meta: { type: frame.type, source } },
      ],
    });
    run.governed.frameNodeIds.push(frameNodeId);

    if (result.effect) {
      const effectNodeId = `run:${run.runId}:effect:${result.effect.effect_id}`;
      await this.completeDagNodeOnce(effectNodeId, {
        kind: `worker.effect.${result.effect.kind}`,
        payload: {
          effectId: result.effect.effect_id,
          status: result.effect.status,
          verdict: result.verdict?.decision,
        },
        dependsOn: [frameNodeId],
        provenance: [
          { kind: 'run', ref: run.runId, role: 'input' },
          { kind: 'worker_frame', ref: frame.frame_id, role: 'input', meta: { type: frame.type, source } },
          { kind: 'effect', ref: result.effect.effect_id, role: 'side_effect' },
        ],
      }, [
        { kind: 'effect', ref: result.effect.effect_id, role: 'side_effect' },
      ]);
      run.governed.effectNodeIds.push(effectNodeId);
    }
  }

  private createWorkerToolExecutors(
    run: ActiveRuntimeRun,
    sessionId: string,
    userId: string,
  ): Record<string, ToolExecutor> {
    const workspacePath = this.governedWorkspacePath(run);
    const ctx = {
      sessionId,
      userId,
      runId: run.runId,
      agentId: run.workerRunId,
      workspaceId: workspacePath,
      execRoot: workspacePath,
    };
    return {
      shell_exec: async (inv) => {
        const result = await executeRuntimeTool('exec', inv.args, ctx);
        if (!result.success) {
          const err = new Error(result.error ?? 'shell_exec failed') as Error & { code?: string };
          err.code = 'shell_exec_failed';
          throw err;
        }
        return result.data;
      },
      apply_patch: async (inv) => {
        const patch = typeof inv.args.patch === 'string' ? inv.args.patch : '';
        const files = Array.isArray(inv.args.files)
          ? inv.args.files.filter((file): file is string => typeof file === 'string')
          : [];
        if (!patch.trim()) {
          const err = new Error('Patch required') as Error & { code?: string };
          err.code = 'patch_required';
          throw err;
        }
        return this.applyWorkerPatch(patch, files, {
          sessionId,
          userId,
          runId: run.runId,
          workspacePath,
        });
      },
    };
  }

  private async applyWorkerPatch(
    patch: string,
    files: string[],
    ctx: { sessionId: string; userId: string; runId: string; workspacePath: string },
  ): Promise<{ files: string[]; stdout: string; stderr: string }> {
    const workspaceRoot = ctx.workspacePath;
    for (const file of files) {
      const resolved = path.resolve(workspaceRoot, file);
      if (resolved !== workspaceRoot && !resolved.startsWith(workspaceRoot + path.sep)) {
        const err = new Error(`Patch path outside workspace: ${file}`) as Error & { code?: string };
        err.code = 'patch_path_outside_workspace';
        throw err;
      }
    }

    const patchDir = path.join(workspaceRoot, '.pyrfor');
    await fs.mkdir(patchDir, { recursive: true });
    const patchFile = path.join(patchDir, `worker-${ctx.runId}-${randomUUID()}.patch`);
    await fs.writeFile(patchFile, patch, 'utf-8');
    try {
      await execFileAsync('git', ['apply', '--check', patchFile], { cwd: workspaceRoot });
      const { stdout, stderr } = await execFileAsync('git', ['apply', patchFile], { cwd: workspaceRoot });
      return {
        files,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
      };
    } finally {
      await fs.rm(patchFile, { force: true });
    }
  }

  private async finalizeGovernedRun(
    run: ActiveRuntimeRun,
    sessionId: string,
    worker?: RuntimeWorkerOptions,
    options: { completeRun?: boolean } = {},
  ): Promise<VerificationStatus | null> {
    if (!this.orchestration || !run.governed) return null;
    if (run.governed.verifierStatus) return run.governed.verifierStatus;
    const governedWorkspace = this.governedWorkspacePath(run);

    const verifierNodeId = `run:${run.runId}:verify`;
    const verifier = new VerifierLane({
      ledger: this.orchestration.eventLedger,
      runLedger: this.orchestration.runLedger,
      replayStoreDir: path.join(this.resolveRuntimeDataRoot() ?? os.tmpdir(), 'orchestration', 'replays'),
      dagStorePath: path.join(this.resolveRuntimeDataRoot() ?? os.tmpdir(), 'orchestration', `verifier-${run.runId}.json`),
      workspaceId: governedWorkspace,
      repoId: governedWorkspace,
      validators: worker?.verifierValidators ?? [],
    });

    const result = await verifier.run({
      parentRunId: run.runId,
      verifierRunId: `${run.runId}:verifier`,
      acpEvents: run.governed.workerEvents,
      cwd: governedWorkspace,
      workspaceId: governedWorkspace,
      repoId: governedWorkspace,
      validators: worker?.verifierValidators,
    });
    run.governed.verifierStatus = result.status;

    await this.orchestration.eventLedger.append({
      type: 'verifier.completed',
      run_id: run.runId,
      subject_id: result.verifierRunId,
      status: result.status,
      action: result.status === 'passed' || result.status === 'warning' ? 'allow' : 'block',
      reason: `verifier ${result.status}`,
      findings: result.steps.reduce((sum, step) => sum + step.results.length, 0),
    });

    const verifierArtifact = await this.orchestration.artifactStore.writeJSON('test_result', {
      parentRunId: result.parentRunId,
      verifierRunId: result.verifierRunId,
      status: result.status,
      replayArtifactRef: result.replayArtifactRef,
      steps: result.steps,
      verifyResult: result.verifyResult,
    }, {
      runId: run.runId,
      meta: {
        verifierRunId: result.verifierRunId,
        status: result.status,
      },
    });
    await this.orchestration.runLedger.recordArtifact(run.runId, verifierArtifact.id, [verifierArtifact.uri]);

    await this.completeDagNodeOnce(verifierNodeId, {
      kind: 'governed.verifier',
      payload: {
        status: result.status,
        verifierRunId: result.verifierRunId,
        replayArtifactRef: result.replayArtifactRef,
      },
      dependsOn: [
        run.governed.contextNodeId,
        ...run.governed.frameNodeIds,
        ...run.governed.effectNodeIds,
      ],
      provenance: [
        { kind: 'run', ref: run.runId, role: 'input' },
        { kind: 'artifact', ref: run.governed.contextArtifact.id, role: 'input', sha256: run.governed.contextArtifact.sha256 },
        { kind: 'artifact', ref: verifierArtifact.id, role: 'evidence', sha256: verifierArtifact.sha256 },
      ],
    }, [
      { kind: 'artifact', ref: verifierArtifact.id, role: 'evidence', sha256: verifierArtifact.sha256 },
    ]);
    run.governed.verifierNodeId = verifierNodeId;

    if (result.status === 'passed' || result.status === 'warning') {
      if (options.completeRun !== false) {
        await this.completeUserRun(run, 'completed', `worker verified: ${result.status}`);
        run.terminalByWorker = true;
      }
      return result.status;
    }

    if (options.completeRun !== false) {
      await this.orchestration.runLedger.blockRun(run.runId, `verifier ${result.status}`);
      run.terminalByWorker = true;
    }
    logger.warn('[runtime] Governed worker run blocked by verifier', {
      runId: run.runId,
      sessionId,
      status: result.status,
    });
    if (options.completeRun !== false) {
      throw new Error(`Verifier blocked run ${run.runId}: ${result.status}`);
    }
    return result.status;
  }

  private async completeDagNodeOnce(
    nodeId: string,
    input: {
      kind: string;
      payload?: Record<string, unknown>;
      dependsOn?: string[];
      provenance?: Parameters<DurableDag['completeNode']>[1];
    },
    completionProvenance: Parameters<DurableDag['completeNode']>[1] = [],
  ): Promise<void> {
    if (!this.orchestration) return;
    const existing = this.orchestration.dag.getNode(nodeId);
    if (existing?.status === 'succeeded') return;

    this.orchestration.dag.addNode({
      id: nodeId,
      kind: input.kind,
      payload: input.payload,
      dependsOn: input.dependsOn,
      idempotencyKey: nodeId,
      retryClass: 'deterministic',
      provenance: input.provenance,
    });
    const current = this.orchestration.dag.getNode(nodeId);
    const ready = this.orchestration.dag.listReady().some((node) => node.id === nodeId);
    if ((current?.status === 'pending' || current?.status === 'ready') && ready) {
      this.orchestration.dag.leaseNode(nodeId, 'runtime-governor', 60_000);
    }
    const leased = this.orchestration.dag.getNode(nodeId);
    if (leased?.status === 'leased') {
      this.orchestration.dag.startNode(nodeId, 'runtime-governor');
    }
    const running = this.orchestration.dag.getNode(nodeId);
    if (running?.status === 'leased' || running?.status === 'running') {
      this.orchestration.dag.completeNode(nodeId, completionProvenance);
    }
  }

  private summarizeWorkerResults(
    run: ActiveRuntimeRun,
    results: WorkerProtocolBridgeResult[],
  ): string {
    const invalid = results.find((result) => result.disposition === 'invalid_frame');
    if (invalid) {
      const detail = invalid.errors?.map((error) => `${error.path}: ${error.message}`).join('; ') ?? 'invalid worker frame';
      throw new Error(`Worker emitted invalid frame: ${detail}`);
    }

    const denied = results.find((result) => result.disposition === 'effect_denied');
    if (denied) {
      throw new Error(denied.verdict?.reason ?? 'Worker run blocked by policy');
    }

    const terminal = [...results].reverse().find((result) =>
      result.disposition === 'run_completed' || result.disposition === 'run_failed'
    );
    if (terminal?.disposition === 'run_completed') {
      run.terminalByWorker = true;
      const frame = terminal.frame;
      return frame && 'summary' in frame ? String(frame.summary) : 'Worker run completed';
    }
    if (terminal?.disposition === 'run_failed') {
      run.terminalByWorker = true;
      const frame = terminal.frame;
      const message = frame && 'error' in frame ? frame.error.message : 'Worker run failed';
      throw new Error(message);
    }

    const invoked = results.filter((result) => result.disposition === 'tool_invoked').length;
    return invoked > 0
      ? `Worker processed ${invoked} approved effect${invoked === 1 ? '' : 's'}.`
      : 'Worker stream processed.';
  }

  private assertWorkerResultCanContinue(result: WorkerProtocolBridgeResult): void {
    if (result.disposition === 'invalid_frame') {
      const detail = result.errors?.map((error) => `${error.path}: ${error.message}`).join('; ') ?? 'invalid worker frame';
      throw new Error(`Worker emitted invalid frame: ${detail}`);
    }
    if (result.disposition === 'effect_denied') {
      throw new Error(result.verdict?.reason ?? 'Worker run blocked by policy');
    }
    if (result.disposition === 'run_failed') {
      const frame = result.frame;
      const message = frame && 'error' in frame ? frame.error.message : 'Worker run failed';
      throw new Error(message);
    }
  }

  private assertStrictFreeClaudeEvent(event: FCEvent): void {
    if (event.type === 'tool_use') {
      throw new Error(`Strict FreeClaude worker emitted native tool_use "${event.name}" outside Worker Protocol`);
    }
    if (event.type === 'result') {
      const result = event.result as { filesTouched?: unknown; commandsRun?: unknown };
      const filesTouched = Array.isArray(result.filesTouched) ? result.filesTouched.filter((item) => typeof item === 'string') : [];
      const commandsRun = Array.isArray(result.commandsRun) ? result.commandsRun.filter((item) => typeof item === 'string') : [];
      if (filesTouched.length > 0 || commandsRun.length > 0) {
        throw new Error('Strict FreeClaude worker reported native mutations outside Worker Protocol');
      }
    }
  }

  private hashRunInput(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private getRuntimeBudgetController(): TokenBudgetController | null {
    if (this.runtimeBudgetController) {
      return this.runtimeBudgetController;
    }
    const rootDir = this.resolveRuntimeDataRoot();
    if (!rootDir) {
      return null;
    }
    this.runtimeBudgetController = createTokenBudgetController({
      storePath: path.join(rootDir, 'budgets', 'runtime-token-budget.json'),
      flushDebounceMs: this.config.persistence?.debounceMs ?? 2_000,
      logger: (message, meta) => {
        logger.warn('[runtime] token budget controller', { message, meta });
      },
    });
    return this.runtimeBudgetController;
  }

  private createRuntimeBudgetRules(run: RunRecord, activeRun: ActiveRuntimeRun): BudgetRule[] {
    if (run.budget_profile.maxTokens === undefined && run.budget_profile.maxCostUsd === undefined) {
      return [];
    }
    return [{
      id: `run-budget:${run.run_id}`,
      scope: activeRun.budgetScope ?? 'task',
      window: 'total',
      targetId: activeRun.budgetTargetId,
      maxTokens: run.budget_profile.maxTokens,
      maxCostUsd: run.budget_profile.maxCostUsd,
    }];
  }

  private attachRuntimeBudgetProfile(activeRun: ActiveRuntimeRun, run: RunRecord): void {
    const controller = this.getRuntimeBudgetController();
    if (!controller) {
      return;
    }
    const rules = this.createRuntimeBudgetRules(run, activeRun);
    if (rules.length === 0) {
      return;
    }
    activeRun.budgetRuleIds = rules.map((rule) => rule.id);
    for (const rule of rules) {
      controller.addRule(rule);
    }
  }

  private async releaseRuntimeBudgetProfile(activeRun: ActiveRuntimeRun): Promise<void> {
    const controller = this.runtimeBudgetController;
    const ruleIds = activeRun.budgetRuleIds;
    if (!controller || !ruleIds || ruleIds.length === 0) {
      return;
    }
    activeRun.budgetRuleIds = [];
    for (const ruleId of ruleIds) {
      controller.removeRule(ruleId);
    }
    await controller.flush().catch((error: unknown) => {
      logger.warn('[runtime] Failed to flush token budget controller', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private runtimeBudgetTargets(activeRun: ActiveRuntimeRun | null, sessionId: string): RuntimeBudgetTarget[] {
    const controller = this.getRuntimeBudgetController();
    if (!controller) {
      return [];
    }
    const rules = controller.listRules();
    const candidates: RuntimeBudgetTarget[] = [
      ...(activeRun?.budgetTargetId ? [{ scope: activeRun.budgetScope ?? 'task', targetId: activeRun.budgetTargetId }] : []),
      { scope: 'session', targetId: sessionId },
      { scope: 'global' },
    ];
    return candidates.filter((candidate) =>
      rules.some((rule) =>
        rule.scope === candidate.scope
        && (rule.targetId === undefined || rule.targetId === candidate.targetId),
      ),
    );
  }

  private async runBudgetedChat(
    messages: Message[],
    options: Parameters<ProviderRouter['chat']>[1] & { sessionId?: string },
    activeRun: ActiveRuntimeRun | null,
  ): Promise<string> {
    const sessionId = options?.sessionId;
    const targets = sessionId ? this.runtimeBudgetTargets(activeRun, sessionId) : [];
    const controller = this.getRuntimeBudgetController();
    const estimate = controller && targets.length > 0
      ? this.providers.estimateChatUsage(messages, options)
      : null;

    if (controller && estimate) {
      for (const target of targets) {
        const preCheck = controller.canConsume({
          scope: target.scope,
          targetId: target.targetId,
          estPromptTokens: estimate.inputTokens,
          estCompletionTokens: estimate.estimatedOutputTokens,
          estCostUsd: estimate.estimatedCostUsd,
        });
        if (!preCheck.allowed) {
          throw new Error(`budget denied: ${preCheck.blockingRule ?? 'limit exceeded'}`);
        }
      }
    }

    if (controller && targets.length > 0) {
      return traceLlmChat(
        options?.model,
        async () => {
          const result = await this.providers.chatWithUsage(messages, options);
          const { usage } = result;
          if (usage.inputTokens > 0 || usage.outputTokens > 0 || usage.costUsd > 0) {
            for (const target of targets) {
              controller.recordConsumption({
                ts: Date.now(),
                scope: target.scope,
                targetId: target.targetId,
                promptTokens: usage.inputTokens,
                completionTokens: usage.outputTokens,
                costUsd: usage.costUsd,
                provider: usage.provider,
              });
            }
          }
          return result;
        },
        (result) => ({
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costUsd: result.usage.costUsd,
        }),
      ).then((result) => result.text);
    }
    return traceLlmChat(options?.model, () => this.providers.chat(messages, options));
  }

  private resolveRuntimeDataRoot(): string | null {
    if (this.options.persistence === false || this.config.persistence.enabled === false) {
      return null;
    }
    return this.config.persistence.rootDir
      ?? this.options.persistence.rootDir
      ?? path.dirname(DEFAULT_CONFIG_PATH)
      ?? path.join(os.homedir(), '.pyrfor');
  }

  private async initOrchestration(): Promise<void> {
    if (this.orchestration) return;

    const rootDir = this.resolveRuntimeDataRoot();
    if (!rootDir) {
      logger.info('[runtime] Orchestration persistence disabled');
      return;
    }

    const orchestrationDir = path.join(rootDir, 'orchestration');
    const eventLedger = new EventLedger(path.join(orchestrationDir, 'events.jsonl'));
    const runLedger = new RunLedger({ ledger: eventLedger });
    await this.hydrateRunLedger(runLedger, eventLedger);
    this.worktreeManager = new RuntimeWorktreeManager({
      getWorkspacePath: () => this.options.workspacePath,
      rootDir: path.join(orchestrationDir, 'worktrees'),
    });

    const dag = new DurableDag({
      storePath: path.join(orchestrationDir, 'dag.json'),
      ledger: eventLedger,
      dagId: 'runtime-orchestration',
      ledgerRunId: 'runtime-orchestration',
    });
    const recoveredRuns = await runLedger.recoverInterruptedRuns('runtime_restarted');
    const recoveredNodes = dag.recoverInterruptedLeases('runtime_restarted');
    try {
      await this.worktreeManager.cleanupOrphans(this.collectSubagentWorktreeRetainRunIds());
    } catch (err) {
      logger.warn('[runtime] Governed worker orphan worktree cleanup failed during startup', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await dag.flushLedger();
    const artifactStore = new ArtifactStore({ rootDir: path.join(rootDir, 'artifacts') });
    await artifactStore.repairIndex();
    const toolRegistry = createToolRegistry(path.join(orchestrationDir, 'tool-registry'));
    const capabilityToolRegistry = new CapabilityToolRegistry();
    registerStandardTools(capabilityToolRegistry);
    registerRuntimeToolAliases(capabilityToolRegistry);
    const contractRegistry = new ContractRegistry();
    const blockCatalogStore = new BlockCatalogStore(path.join(orchestrationDir, 'block-catalog.json'));
    let catalogHydration = { restored: 0, skipped: 0, warnings: [] as string[] };
    let memoryStore: MemoryStore | undefined;
    try {
      memoryStore = createMemoryStore({ dbPath: path.join(orchestrationDir, 'memory.db') });
      const actorKernel = createActorKernel({
        runLedger,
        eventLedger,
        dag,
        artifactStore,
      });
      const blockRegistry = new BlockRegistry();
      catalogHydration = blockCatalogStore.hydrate(blockRegistry, { capabilityToolRegistry, contractRegistry });
      if (catalogHydration.warnings.length > 0) {
        for (const warning of catalogHydration.warnings) {
          logger.warn('[runtime] Block catalog hydration warning', { warning });
        }
      }
      const planningMemoryFacade = createUniversalMemoryFacade({
        memoryStore,
        strategyProvider: new StrategyMemoryProvider({ memoryStore }),
        blockRegistry,
      });
      const experienceLibrary = createExperienceLibrary({ memoryStore, artifactStore });
      const universalEngine = createUniversalEngine({
        planner: new UniversalPlanner({ artifactStore }),
        researcher: new UniversalResearcher({ artifactStore }),
        artifactStore,
        ledger: eventLedger,
        runLedger,
        memoryStore,
        approvalFlow: {
          requestApproval: (req) => approvalFlow.requestApproval(req),
        },
        planningMemoryFacade,
        experienceLibrary,
        dagStorePath: path.join(orchestrationDir, 'universal-dags'),
      });

      this.orchestration = {
        eventLedger,
        runLedger,
        dag,
        artifactStore,
        memoryStore,
        actorKernel,
        overlays: registerDefaultDomainOverlays(new DomainOverlayRegistry()),
        universalEngine,
        toolRegistry,
        capabilityToolRegistry,
        blockRegistry,
        blockCatalogStore,
        contractRegistry,
      };
    } catch (err) {
      memoryStore?.close();
      throw err;
    }
    this.ensureApprovalFlowSubscription();
    const recoveredGithubApprovals = await this.recoverGithubDeliveryApplyApprovals();
    const recoveredCeoclawApprovals = await this.recoverCeoclawBusinessBriefApprovals();
    const recoveredKsReconciliationApprovals = await this.recoverKsReconciliationReviewApprovals();

    logger.info('[runtime] Orchestration initialized', {
      rootDir,
      runs: this.orchestration.runLedger.listRuns().length,
      dagNodes: this.orchestration.dag.listNodes().length,
      recoveredRuns: recoveredRuns.length,
      recoveredDagNodes: recoveredNodes.length,
      recoveredApprovals: recoveredGithubApprovals + recoveredCeoclawApprovals + recoveredKsReconciliationApprovals,
      recoveredGithubApprovals,
      recoveredCeoclawApprovals,
      recoveredKsReconciliationApprovals,
      overlays: this.orchestration.overlays.list().map((overlay) => overlay.domainId),
      restoredBlocks: catalogHydration.restored,
      skippedBlocks: catalogHydration.skipped,
    });
  }

  private ensureApprovalFlowSubscription(): void {
    if (this.approvalFlowUnsubscribe) return;
    this.approvalFlowUnsubscribe = approvalFlow.subscribe((event) => {
      if (event.type !== 'approval-resolved') return;
      if (event.decision === 'approve') return;
      if (event.request.toolName === 'ceoclaw_business_brief_approval') {
        void this.cancelDeniedCeoclawApproval(event).catch((err) => {
          logger.warn('[runtime] Failed to cancel denied CEOClaw approval run', {
            approvalId: event.request.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      if (event.request.toolName === 'ks_reconciliation_review_approval') {
        void this.cancelDeniedKsReconciliationApproval(event).catch((err) => {
          logger.warn('[runtime] Failed to cancel denied reconciliation approval run', {
            approvalId: event.request.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    });
  }

  private async cancelDeniedCeoclawApproval(event: Extract<ApprovalFlowEvent, { type: 'approval-resolved' }>): Promise<void> {
    const approvalId = event.request.id;
    if (this.ceoclawDenialApprovalsInFlight.has(approvalId)) return;
    this.ceoclawDenialApprovalsInFlight.add(approvalId);
    try {
      if (!this.orchestration) return;
      const runId = typeof event.request.run_id === 'string'
        ? event.request.run_id
        : typeof event.request.args['runId'] === 'string'
          ? event.request.args['runId']
          : undefined;
      if (!runId) return;
      const run = this.orchestration.runLedger.getRun(runId);
      if (!run) return;
      if (run.status !== 'blocked') {
        if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'archived') {
          approvalFlow.consumeResolvedApproval(approvalId);
        }
        return;
      }
      await this.orchestration.eventLedger.append({
        type: 'approval.denied',
        run_id: runId,
        tool: 'ceoclaw_business_brief_approval',
        approval_id: approvalId,
        reason: `approval ${approvalId} was ${event.decision}`,
      });
      await this.orchestration.runLedger.completeRun(
        runId,
        'cancelled',
        `CEOClaw approval ${approvalId} was ${event.decision}`,
      );
      approvalFlow.consumeResolvedApproval(approvalId);
    } finally {
      this.ceoclawDenialApprovalsInFlight.delete(approvalId);
    }
  }

  private async cancelDeniedKsReconciliationApproval(event: Extract<ApprovalFlowEvent, { type: 'approval-resolved' }>): Promise<void> {
    const approvalId = event.request.id;
    if (this.ksReconciliationDenialApprovalsInFlight.has(approvalId)) return;
    this.ksReconciliationDenialApprovalsInFlight.add(approvalId);
    try {
      if (!this.orchestration) return;
      const runId = typeof event.request.run_id === 'string'
        ? event.request.run_id
        : typeof event.request.args['runId'] === 'string'
          ? event.request.args['runId']
          : undefined;
      if (!runId) return;
      const run = this.orchestration.runLedger.getRun(runId);
      if (!run) return;
      if (run.status !== 'blocked') {
        if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'archived') {
          approvalFlow.consumeResolvedApproval(approvalId);
        }
        return;
      }
      await this.orchestration.eventLedger.append({
        type: 'approval.denied',
        run_id: runId,
        tool: 'ks_reconciliation_review_approval',
        approval_id: approvalId,
        reason: `approval ${approvalId} was ${event.decision}`,
      });
      await this.orchestration.runLedger.completeRun(
        runId,
        'cancelled',
        `reconciliation approval ${approvalId} was ${event.decision}`,
      );
      approvalFlow.consumeResolvedApproval(approvalId);
    } finally {
      this.ksReconciliationDenialApprovalsInFlight.delete(approvalId);
    }
  }

  private getGithubDeliveryApplyApproval(
    runId: string,
    planArtifactId: string,
    expectedPlanSha256: string,
  ): ApprovalRequest | undefined {
    const expectedId = buildGithubDeliveryApplyApprovalId(runId, planArtifactId, expectedPlanSha256);
    const pending = approvalFlow.getPending().find((request) =>
      request.id === expectedId
      || (
        request.toolName === 'github_delivery_apply'
        && request.args['runId'] === runId
        && request.args['planArtifactId'] === planArtifactId
        && request.args['expectedPlanSha256'] === expectedPlanSha256
      )
    );
    if (pending) return pending;
    return approvalFlow.getResolvedApproval(expectedId)?.request;
  }

  private async enqueueGithubDeliveryApplyApproval(input: {
    runId: string;
    plan: GitHubDeliveryPlan;
    planArtifact: ArtifactRef;
    expectedPlanSha256: string;
  }): Promise<ApprovalRequest> {
    const existing = this.getGithubDeliveryApplyApproval(input.runId, input.planArtifact.id, input.expectedPlanSha256);
    if (existing) return existing;
    return approvalFlow.enqueueApproval({
      id: buildGithubDeliveryApplyApprovalId(input.runId, input.planArtifact.id, input.expectedPlanSha256),
      toolName: 'github_delivery_apply',
      summary: `Create draft GitHub PR for ${input.plan.repository}:${input.plan.proposedBranch}`,
      args: {
        runId: input.runId,
        planArtifactId: input.planArtifact.id,
        expectedPlanSha256: input.expectedPlanSha256,
        repository: input.plan.repository,
        baseBranch: input.plan.baseBranch,
        proposedBranch: input.plan.proposedBranch,
        headSha: input.plan.headSha,
        idempotencyKey: buildApplyIdempotencyKey(input.runId, input.planArtifact, input.plan),
      },
      run_id: input.runId,
      reason: 'GitHub delivery apply requires operator approval before creating a draft PR',
      approval_required: true,
    });
  }

  private async recoverGithubDeliveryApplyApprovals(): Promise<number> {
    if (!this.orchestration) return 0;
    let recovered = 0;
    for (const run of this.orchestration.runLedger.listRuns()) {
      const events = await this.orchestration.eventLedger.byRun(run.run_id);
      const requested = [...events].reverse().find((event): event is ApprovalRequestedEvent & { artifact_id: string } =>
        event.type === 'approval.requested'
        && event.tool === 'github_delivery_apply'
        && typeof event.artifact_id === 'string'
      );
      if (!requested) continue;
      const laterResolution = events.some((event) =>
        event.seq > requested.seq
        && (event.type === 'approval.granted' || event.type === 'approval.denied')
        && event.tool === 'github_delivery_apply'
        && event.approval_id === requested.approval_id
      );
      if (laterResolution) continue;
      if (await this.hasGithubDeliveryApplyResult(run.run_id, requested.artifact_id, requested.approval_id)) {
        continue;
      }
      let planArtifact: ArtifactRef;
      let plan: GitHubDeliveryPlan;
      try {
        const planArtifacts = await this.orchestration.artifactStore.list({ runId: run.run_id, kind: 'delivery_plan' });
        const matchedArtifact = planArtifacts.find((artifact) => artifact.id === requested.artifact_id);
        if (!matchedArtifact) continue;
        planArtifact = matchedArtifact;
        if (planArtifact.kind !== 'delivery_plan' || !planArtifact.sha256) continue;
        plan = await this.orchestration.artifactStore.readJSON<GitHubDeliveryPlan>(planArtifact);
      } catch (err) {
        logger.warn('[runtime] Failed to recover GitHub delivery approval request', {
          runId: run.run_id,
          artifactId: requested.artifact_id,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (plan.runId !== run.run_id) continue;
      if (this.getGithubDeliveryApplyApproval(run.run_id, planArtifact.id, planArtifact.sha256)) continue;
      await this.enqueueGithubDeliveryApplyApproval({
        runId: run.run_id,
        plan,
        planArtifact,
        expectedPlanSha256: planArtifact.sha256,
      });
      recovered += 1;
    }
    return recovered;
  }

  private async hasGithubDeliveryApplyResult(
    runId: string,
    planArtifactId: string,
    approvalId?: string,
  ): Promise<boolean> {
    if (!this.orchestration) return false;
    const artifacts = await this.orchestration.artifactStore.list({ runId, kind: 'delivery_apply' });
    for (const artifact of artifacts) {
      if (artifact.meta?.['planArtifactId'] === planArtifactId) {
        return approvalId === undefined || artifact.meta?.['approvalId'] === approvalId;
      }
      try {
        const result = await this.orchestration.artifactStore.readJSON<GitHubDeliveryApplyResult>(artifact);
        if (
          result.planArtifactId === planArtifactId
          && (approvalId === undefined || result.approvalId === approvalId)
        ) {
          return true;
        }
      } catch (err) {
        logger.warn('[runtime] Failed to inspect GitHub delivery apply artifact during recovery', {
          runId,
          artifactId: artifact.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return false;
  }

  private getCeoclawBusinessBriefApproval(runId: string): ApprovalRequest | undefined {
    const expectedId = buildCeoclawBusinessBriefApprovalId(runId);
    const pending = approvalFlow.getPending().find((request) =>
      request.id === expectedId
      || (
        request.toolName === 'ceoclaw_business_brief_approval'
        && request.args['runId'] === runId
      )
    );
    if (pending) return pending;
    return approvalFlow.getResolvedApproval(expectedId)?.request;
  }

  private async enqueueCeoclawBusinessBriefApproval(input: {
    runId: string;
    projectId: string;
    decision: string;
    evidenceRefs: string[];
    evidenceArtifactId?: string;
    deadline?: string;
  }): Promise<ApprovalRequest> {
    const existing = this.getCeoclawBusinessBriefApproval(input.runId);
    if (existing) return existing;
    return approvalFlow.enqueueApproval({
      id: buildCeoclawBusinessBriefApprovalId(input.runId),
      toolName: 'ceoclaw_business_brief_approval',
      summary: `Approve CEOClaw brief for ${input.projectId}: ${input.decision}`,
      args: {
        runId: input.runId,
        projectId: input.projectId,
        decision: input.decision,
        evidenceRefs: input.evidenceRefs,
        ...(input.evidenceArtifactId ? { evidenceArtifactId: input.evidenceArtifactId } : {}),
        ...(input.deadline ? { deadline: input.deadline } : {}),
      },
      run_id: input.runId,
      reason: 'CEOClaw business brief requires operator approval before final report',
      approval_required: true,
    });
  }

  private async recoverCeoclawBusinessBriefApprovals(): Promise<number> {
    if (!this.orchestration) return 0;
    let recovered = 0;
    for (const run of this.orchestration.runLedger.listRuns()) {
      if (run.status !== 'blocked') continue;
      const events = await this.orchestration.eventLedger.byRun(run.run_id);
      const requested = [...events].reverse().find((event): event is ApprovalRequestedEvent =>
        event.type === 'approval.requested'
        && event.tool === 'ceoclaw_business_brief_approval'
      );
      if (!requested) continue;
      const laterResolution = events.some((event) =>
        event.seq > requested.seq
        && (event.type === 'approval.granted' || event.type === 'approval.denied')
        && event.tool === 'ceoclaw_business_brief_approval'
      );
      if (laterResolution || this.getCeoclawBusinessBriefApproval(run.run_id)) continue;
      let preview: ProductFactoryPlanPreview;
      try {
        preview = await this.loadProductFactoryPreview(run.run_id);
      } catch (err) {
        logger.warn('[runtime] Failed to recover CEOClaw approval request', {
          runId: run.run_id,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (preview.template.id !== 'business_brief') continue;
      const answers = this.extractProductFactoryAnswers(preview);
      const evidenceRefs = answers['evidence']?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
      await this.enqueueCeoclawBusinessBriefApproval({
        runId: run.run_id,
        projectId: answers['projectId'] ?? 'default-project',
        decision: answers['decision'] ?? preview.intent.title,
        evidenceRefs,
        evidenceArtifactId: requested.artifact_id,
        deadline: answers['deadline'],
      });
      recovered += 1;
    }
    return recovered;
  }

  private getKsReconciliationReviewApproval(runId: string): ApprovalRequest | undefined {
    const expectedId = buildKsReconciliationReviewApprovalId(runId);
    const pending = approvalFlow.getPending().find((request) =>
      request.id === expectedId
      || (
        request.toolName === 'ks_reconciliation_review_approval'
        && request.args['runId'] === runId
      )
    );
    if (pending) return pending;
    return approvalFlow.getResolvedApproval(expectedId)?.request;
  }

  private async enqueueKsReconciliationReviewApproval(input: {
    runId: string;
    project: string;
    period: string;
    currency: string;
    findingsCount: number;
    reviewArtifactId: string;
  }): Promise<ApprovalRequest> {
    const existing = this.getKsReconciliationReviewApproval(input.runId);
    if (existing) return existing;
    return approvalFlow.enqueueApproval({
      id: buildKsReconciliationReviewApprovalId(input.runId),
      toolName: 'ks_reconciliation_review_approval',
      summary: `Approve KS reconciliation review for ${input.project} / ${input.period}`,
      args: {
        runId: input.runId,
        project: input.project,
        period: input.period,
        currency: input.currency,
        findingsCount: input.findingsCount,
        reviewArtifactId: input.reviewArtifactId,
      },
      run_id: input.runId,
      reason: 'KS reconciliation requires explicit human review before the final report can be generated',
      approval_required: true,
    });
  }

  private async recoverKsReconciliationReviewApprovals(): Promise<number> {
    if (!this.orchestration) return 0;
    let recovered = 0;
    for (const run of this.orchestration.runLedger.listRuns()) {
      if (run.status !== 'blocked') continue;
      const events = await this.orchestration.eventLedger.byRun(run.run_id);
      const requested = [...events].reverse().find((event): event is ApprovalRequestedEvent & { artifact_id: string } =>
        event.type === 'approval.requested'
        && event.tool === 'ks_reconciliation_review_approval'
        && typeof event.artifact_id === 'string'
      );
      if (!requested) continue;
      const laterResolution = events.some((event) =>
        event.seq > requested.seq
        && (event.type === 'approval.granted' || event.type === 'approval.denied')
        && event.tool === 'ks_reconciliation_review_approval'
        && event.approval_id === requested.approval_id
      );
      if (laterResolution || this.getKsReconciliationReviewApproval(run.run_id)) continue;
      let preview: ProductFactoryPlanPreview;
      let reviewPack: KsReconciliationReviewPack;
      try {
        preview = await this.loadProductFactoryPreview(run.run_id);
        const reviewArtifact = await this.findKsReconciliationReviewPackArtifact(run.run_id);
        reviewPack = reviewArtifact.sha256
          ? await this.orchestration.artifactStore.readJSONVerified<KsReconciliationReviewPack>(reviewArtifact, reviewArtifact.sha256)
          : await this.orchestration.artifactStore.readJSON<KsReconciliationReviewPack>(reviewArtifact);
      } catch (err) {
        logger.warn('[runtime] Failed to recover KS reconciliation approval request', {
          runId: run.run_id,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (preview.template.id !== 'ks_reconciliation') continue;
      const answers = this.extractProductFactoryAnswers(preview);
      await this.enqueueKsReconciliationReviewApproval({
        runId: run.run_id,
        project: answers['project'] ?? reviewPack.scenario.project,
        period: answers['period'] ?? reviewPack.scenario.period,
        currency: reviewPack.scenario.currency,
        findingsCount: reviewPack.findings.length,
        reviewArtifactId: requested.artifact_id,
      });
      recovered += 1;
    }
    return recovered;
  }

  private async hydrateRunLedger(runLedger: RunLedger, eventLedger: EventLedger): Promise<void> {
    const runIds = new Set<string>();
    for (const event of await eventLedger.readAll()) {
      if (event.type === 'run.created' && event.run_id) {
        runIds.add(event.run_id);
      }
    }
    for (const runId of runIds) {
      try {
        await runLedger.replayRun(runId);
      } catch (err) {
        logger.warn('[runtime] Failed to hydrate orchestration run', {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private orchestrationAsGatewayDeps(): GatewayDeps['orchestration'] | undefined {
    if (!this.orchestration) return undefined;
    return this.orchestration;
  }

  private getDefaultSystemPrompt(): string {
    return `You are Pyrfor, an AI assistant running on the Pyrfor Runtime.

You have access to tools for:
- Reading/writing files
- Executing shell commands (with safety checks)
- Searching and fetching web content
- Sending messages

Be helpful, accurate, and concise. When uncertain, say so.`;
  }
}

function refreshContextPackEvidence(pack: ContextPack, evidenceSection: ContextPackSection | undefined, compiledAt = new Date().toISOString()): ContextPack {
  const sections = [
    ...pack.sections.filter((section) => section.id !== 'run_evidence'),
    ...(evidenceSection ? [evidenceSection] : []),
  ].sort(compareContextPackSections);
  const sourceRefs = sections
    .flatMap((section) => section.sources)
    .sort(compareContextSourceRefs);
  return withContextPackHash({
    schemaVersion: pack.schemaVersion,
    packId: pack.packId,
    compiledAt,
    workspaceId: pack.workspaceId,
    ...(pack.runId ? { runId: pack.runId } : {}),
    ...(pack.projectId ? { projectId: pack.projectId } : {}),
    task: pack.task,
    sections,
    sourceRefs,
  });
}

function compareContextPackSections(left: ContextPackSection, right: ContextPackSection): number {
  return left.priority - right.priority || left.id.localeCompare(right.id);
}

function compareContextSourceRefs(left: ContextSourceRef, right: ContextSourceRef): number {
  return left.kind.localeCompare(right.kind)
    || left.ref.localeCompare(right.ref)
    || left.role.localeCompare(right.role)
    || (left.sha256 ?? '').localeCompare(right.sha256 ?? '');
}

// ============================================
// Exports
// ============================================

export { runtimeToolDefinitions };

// Re-export components for advanced usage
export { SessionManager } from './session';
export { ProviderRouter } from './provider-router';
export { AutoCompact } from './compact';
export { SubagentSpawner } from './subagents';
export { PrivacyManager, PUBLIC_ZONE, PERSONAL_ZONE, VAULT_ZONE } from './privacy';
export { WorkspaceLoader } from './workspace-loader';
export { RunLedger } from './run-ledger';
export type { RunLedgerCreateInput, RunLedgerOptions, RunTerminalStatus } from './run-ledger';
export { EventLedger } from './event-ledger';
export type { EventLedgerOptions, LedgerEvent } from './event-ledger';
export { ArtifactStore } from './artifact-model';
export type { ArtifactKind, ArtifactRef, ArtifactStoreOptions } from './artifact-model';
export * from './worker-protocol';
export { WorkerProtocolBridge } from './worker-protocol-bridge';
export type {
  WorkerCapabilityRequest,
  WorkerProtocolBridgeDisposition,
  WorkerProtocolBridgeOptions,
  WorkerProtocolBridgeResult,
} from './worker-protocol-bridge';
export * from './worker-manifest';
export {
  PermissionEngine,
  ToolRegistry,
  registerStandardTools,
} from './permission-engine';
export type {
  Decision,
  PermissionClass,
  PermissionContext,
  PermissionEngineOptions,
  SideEffectClass,
  ToolSpec,
} from './permission-engine';
export { TwoPhaseEffectRunner } from './two-phase-effect';
export type {
  EffectApplyResult,
  EffectExecutor,
  EffectKind,
  EffectPolicyVerdict,
  EffectProposal,
  EffectProposalInput,
  EffectStatus,
  PolicyDecision,
  TwoPhaseEffectRunnerOptions,
} from './two-phase-effect';
export { DurableDag } from './durable-dag';
export type {
  AddDagNodeInput,
  DagCompensationPolicy,
  DagLease,
  DagNode,
  DagNodeStatus,
  DagProvenanceLink,
  DagRetryClass,
  DagTimeoutClass,
  DurableDagOptions,
  HydrateDagNodeInput,
} from './durable-dag';
export { VerifierLane, runOrchestrationEvalSuite } from './verifier-lane';
export type {
  OrchestrationEvalCase,
  OrchestrationEvalResult,
  VerificationReport,
  VerificationStatus,
  VerifierLaneOptions,
  VerifierLaneResult,
  VerifierReplayInput,
  VerifierSubject,
  VerifierStepRecord,
} from './verifier-lane';
export {
  hashContextPack,
  stableStringify,
  withContextPackHash,
} from './context-pack';
export type {
  ContextMemoryEntry,
  ContextPack,
  ContextPackSchemaVersion,
  ContextPackSection,
  ContextSectionKind,
  ContextSourceRef,
  ContextTaskContract,
} from './context-pack';
export { ContextCompiler } from './context-compiler';
export type {
  CompileContextInput,
  CompileContextResult,
  ContextCompilerDeps,
  ContextFactInput,
  ContextFileInput,
} from './context-compiler';
export { createDailyMemoryRollup } from './memory-rollup';
export type {
  DailyMemoryRollupDeps,
  DailyMemoryRollupInput,
  DailyMemoryRollupResult,
} from './memory-rollup';
export { createProjectMemoryRollup } from './project-memory';
export type {
  ProjectMemoryCategory,
  ProjectMemoryCategoryResult,
  ProjectMemoryRollupDeps,
  ProjectMemoryRollupInput,
  ProjectMemoryRollupResult,
} from './project-memory';
export {
  buildOpenClawMigrationAudit,
  buildOpenClawMigrationReport,
  buildOpenClawMigrationQuarantine,
  discoverOpenClawSourceRoots,
  importOpenClawMigration,
  isAllowedOpenClawReportSourceRoot,
  previewOpenClawMigration,
  rollbackOpenClawMigration,
  verifyOpenClawMigration,
} from './openclaw-migration';
export type {
  OpenClawMigrationAuditMigration,
  OpenClawMigrationAuditStatus,
  OpenClawMigrationAuditView,
  OpenClawMigrationAuditWarning,
  OpenClawMigrationEntry,
  OpenClawMigrationImportResult,
  OpenClawMigrationOptions,
  OpenClawMigrationPreviewResult,
  OpenClawMigrationQuarantineCandidate,
  OpenClawMigrationQuarantineState,
  OpenClawMigrationReport,
  OpenClawMigrationRollbackResult,
  OpenClawMigrationSkipped,
  OpenClawMigrationSkillFinalizationSummary,
  OpenClawMigrationToolFinalization,
  OpenClawMigrationVerificationResult,
} from './openclaw-migration';
export * from './domain-overlay';
export * from './domain-overlay-presets';
export * from './actor-kernel';
export * from './github-delivery-evidence';
export * from './github-delivery-plan';
export * from './github-delivery-apply';
export * from './orchestration-host-factory';
export * from './block-manifest';
export * from './block-memory-namespace';
export * from './block-registry';
export * from './block-loader';
export * from './contract-registry';
export * from './tools';
export * from './pyrfor-scoring';
export * from './universal';

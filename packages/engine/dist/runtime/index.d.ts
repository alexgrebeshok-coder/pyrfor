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
import { SessionManager, type Channel } from './session';
import { SessionStore, type SessionStoreOptions } from './session-store';
import { ProviderRouter } from './provider-router';
import { AutoCompact } from './compact';
import { SubagentSpawner, type SubagentOptions } from './subagents';
import { PrivacyManager } from './privacy';
import { WorkspaceLoader } from './workspace-loader';
import { executeRuntimeTool, runtimeToolDefinitions } from './tools';
import { type OpenFile, type StreamEvent } from './streaming';
import type { TelegramSender } from './telegram-types';
import { type RuntimeConfig } from './config';
import { type GatewayHandle } from './gateway';
import { type VerificationStatus } from './verifier-lane';
import type { AcpEvent } from './acp-client';
import type { FCEvent } from './pyrfor-fc-adapter';
import type { PermissionClass, PermissionEngineOptions } from './permission-engine';
import type { StepValidator } from './step-validator';
import type { ArtifactRef } from './artifact-model';
import type { RunRecord } from './run-lifecycle';
import { type ProductFactoryPlanInput, type ProductFactoryPlanPreview, type ProductFactoryTemplate } from './product-factory';
import { type DeliveryEvidenceSnapshot } from './github-delivery-evidence';
import { type GitHubDeliveryPlan } from './github-delivery-plan';
import { type GitHubDeliveryApplyApplied, type GitHubDeliveryApplyPending, type GitHubDeliveryApplyRequest, type GitHubDeliveryApplyResult } from './github-delivery-apply';
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
export type RuntimeWorkerTransport = 'freeclaude' | 'acp';
export interface RuntimeWorkerOptions {
    transport: RuntimeWorkerTransport;
    events?: (ctx: {
        runId: string;
        taskId: string;
        sessionId: string;
        workerRunId: string;
    }) => AsyncIterable<FCEvent> | AsyncIterable<AcpEvent>;
    domainIds?: string[];
    permissionProfile?: PermissionEngineOptions['profile'];
    permissionOverrides?: Record<string, PermissionClass>;
    verifierValidators?: StepValidator[];
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
export declare class PyrforRuntime {
    sessions: SessionManager;
    providers: ProviderRouter;
    compact: AutoCompact;
    subagents: SubagentSpawner;
    privacy: PrivacyManager;
    workspace: WorkspaceLoader | null;
    store: SessionStore | null;
    /** Current resolved RuntimeConfig. Updated on hot-reload. */
    config: RuntimeConfig;
    private health;
    private cron;
    private gateway;
    private orchestration;
    private readonly productFactory;
    private configPath;
    private _configWatchDispose;
    private options;
    private started;
    private telegramBot;
    constructor(options?: PyrforRuntimeOptions);
    private applyRuntimeConfig;
    setWorkspacePath(workspacePath: string): void;
    getWorkspacePath(): string;
    /**
     * Start all services
     */
    start(): Promise<void>;
    /**
     * Start the HTTP gateway if it is not already running.
     *
     * Used both by start() (when `config.gateway.enabled` is true) and by
     * scenarios that require the gateway regardless of config — e.g., serving
     * Telegram Mini App static files in `--telegram` mode when
     * TELEGRAM_WEBAPP_URL is set. Safe to call multiple times.
     */
    ensureGatewayStarted(): Promise<GatewayHandle | null>;
    /**
     * Reload workspace files and re-register dynamic skills from SKILL.md files.
     * Safe to call at runtime without stopping the runtime.
     */
    reloadSkills(): Promise<number>;
    /**
     * Graceful shutdown — each subsystem is stopped independently so one
     * failure does not block the others. Reverse of start() order.
     */
    stop(): Promise<void>;
    /**
     * Main entry point: handle incoming message
     */
    handleMessage(channel: Channel, userId: string, chatId: string, text: string, options?: {
        sessionId?: string;
        provider?: string;
        model?: string;
        metadata?: Record<string, unknown>;
        worker?: RuntimeWorkerOptions;
        onProgress?: (event: import('./tool-loop').ProgressEvent) => void;
    }): Promise<RuntimeMessageResult>;
    /**
     * Stream a response (for real-time UI)
     */
    streamMessage(channel: Channel, userId: string, chatId: string, text: string, options?: {
        provider?: string;
        model?: string;
    }): AsyncGenerator<{
        type: 'token' | 'error' | 'done';
        content?: string;
        error?: string;
    }, void, unknown>;
    /**
     * Execute a tool directly
     */
    executeTool(toolName: string, args: Record<string, unknown>, context?: {
        sessionId?: string;
        userId?: string;
    }): Promise<ReturnType<typeof executeRuntimeTool>>;
    /**
     * Spawn a subagent task
     */
    spawnSubagent(options: SubagentOptions): {
        success: boolean;
        taskId?: string;
        error?: string;
    };
    /**
     * Get subagent status
     */
    waitForSubagent(taskId: string, timeoutMs?: number): Promise<{
        success: boolean;
        result?: string;
        error?: string;
    }>;
    /**
     * Get runtime statistics
     */
    getStats(): RuntimeStats;
    /**
     * Set Telegram bot instance
     */
    setTelegramBot(bot: TelegramSender | null): void;
    /**
     * Clear session for a given (channel, userId, chatId) tuple.
     * Returns true if a session was found and destroyed.
     */
    clearSession(channel: Channel, userId: string, chatId: string): boolean;
    /**
     * Reload workspace from disk
     */
    reloadWorkspace(): Promise<void>;
    /**
     * Streaming version of `handleMessage` — returns an async generator that
     * emits `StreamEvent` objects.  Integrates with the existing session
     * management, project-rules injection, and multi-file context injection.
     *
     * Used by the `POST /api/chat/stream` gateway endpoint.
     */
    streamChatRequest(input: {
        text: string;
        openFiles?: OpenFile[];
        workspace?: string;
        sessionId?: string;
        userId?: string;
        chatId?: string;
        provider?: string;
        model?: string;
        prefer?: 'local' | 'cloud' | 'auto';
        routingHints?: {
            contextSizeChars?: number;
            sensitive?: boolean;
        };
        worker?: RuntimeWorkerOptions;
    }): AsyncGenerator<StreamEvent>;
    private executeSubagentTask;
    private beginUserRun;
    listProductFactoryTemplates(): ProductFactoryTemplate[];
    previewProductFactoryPlan(input: ProductFactoryPlanInput): ProductFactoryPlanPreview;
    createProductFactoryRun(input: ProductFactoryPlanInput): Promise<{
        run: RunRecord;
        preview: ProductFactoryPlanPreview;
        artifact: ArtifactRef;
    }>;
    executeProductFactoryRun(runId: string, options?: {
        worker?: RuntimeWorkerOptions;
        sessionId?: string;
        userId?: string;
    }): Promise<{
        run: RunRecord;
        deliveryArtifact: ArtifactRef;
        summary: string;
        deliveryEvidenceArtifact?: ArtifactRef;
        deliveryEvidence?: DeliveryEvidenceSnapshot;
    }>;
    captureRunDeliveryEvidence(runId: string, input?: {
        summary?: string;
        verifierStatus?: string;
        deliveryChecklist?: string[];
        deliveryArtifactId?: string;
        issueNumber?: number;
    }): Promise<{
        artifact: ArtifactRef;
        snapshot: DeliveryEvidenceSnapshot;
    }>;
    getRunVerifierStatus(runId: string): Promise<{
        decision: VerifierDecision;
    }>;
    createRunVerifierWaiver(runId: string, input: VerifierWaiverInput): Promise<{
        artifact: ArtifactRef;
        waiver: VerifierWaiverRecord;
        decision: VerifierDecision;
        run: RunRecord;
    }>;
    private resolveRunVerifierDecision;
    private normalizeVerificationStatus;
    private isVerifierWaiverScope;
    private waiverScopeMatches;
    getRunDeliveryEvidence(runId: string): Promise<{
        artifact: ArtifactRef;
        snapshot: DeliveryEvidenceSnapshot;
    } | null>;
    createRunGithubDeliveryPlan(runId: string, input?: {
        issueNumber?: number;
        title?: string;
        body?: string;
    }): Promise<{
        artifact: ArtifactRef;
        plan: GitHubDeliveryPlan;
        evidenceArtifact: ArtifactRef;
    }>;
    getRunGithubDeliveryPlan(runId: string): Promise<{
        artifact: ArtifactRef;
        plan: GitHubDeliveryPlan;
    } | null>;
    requestRunGithubDeliveryApply(runId: string, input: GitHubDeliveryApplyRequest): Promise<GitHubDeliveryApplyPending>;
    applyApprovedRunGithubDelivery(runId: string, input: GitHubDeliveryApplyRequest): Promise<GitHubDeliveryApplyApplied>;
    getRunGithubDeliveryApply(runId: string): Promise<{
        artifact: ArtifactRef;
        result: GitHubDeliveryApplyResult;
    } | null>;
    private loadGithubDeliveryApplyPlan;
    private loadProductFactoryPreview;
    private withProductFactoryDefaultWorker;
    private productFactoryExecutionPrompt;
    private completeProductFactoryDagNodes;
    private completeDeliveryEvidenceDagNode;
    private completeVerifierWaiverDagNode;
    private completeGithubDeliveryPlanDagNode;
    private completeGithubDeliveryApplyDagNode;
    private resolveGithubToken;
    private seedProductFactoryDag;
    private extractProductFactoryAnswers;
    private markUserRunRunning;
    private completeUserRun;
    private createRunAwareToolExecutor;
    private runLiveWorkerStream;
    private prepareGovernedRun;
    private createOrchestrationHostForRun;
    private recordGovernedWorkerFrame;
    private createWorkerToolExecutors;
    private applyWorkerPatch;
    private finalizeGovernedRun;
    private completeDagNodeOnce;
    private summarizeWorkerResults;
    private assertWorkerResultCanContinue;
    private assertStrictFreeClaudeEvent;
    private hashRunInput;
    private resolveRuntimeDataRoot;
    private initOrchestration;
    private hydrateRunLedger;
    private orchestrationAsGatewayDeps;
    private getDefaultSystemPrompt;
}
export { runtimeToolDefinitions };
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
export type { WorkerProtocolBridgeDisposition, WorkerProtocolBridgeOptions, WorkerProtocolBridgeResult, } from './worker-protocol-bridge';
export { TwoPhaseEffectRunner } from './two-phase-effect';
export type { EffectApplyResult, EffectExecutor, EffectKind, EffectPolicyVerdict, EffectProposal, EffectProposalInput, EffectStatus, PolicyDecision, TwoPhaseEffectRunnerOptions, } from './two-phase-effect';
export { DurableDag } from './durable-dag';
export type { AddDagNodeInput, DagCompensationPolicy, DagLease, DagNode, DagNodeStatus, DagProvenanceLink, DagRetryClass, DagTimeoutClass, DurableDagOptions, HydrateDagNodeInput, } from './durable-dag';
export { VerifierLane, runOrchestrationEvalSuite } from './verifier-lane';
export type { OrchestrationEvalCase, OrchestrationEvalResult, VerificationReport, VerificationStatus, VerifierLaneOptions, VerifierLaneResult, VerifierReplayInput, VerifierSubject, VerifierStepRecord, } from './verifier-lane';
export { hashContextPack, stableStringify, withContextPackHash, } from './context-pack';
export type { ContextMemoryEntry, ContextPack, ContextPackSchemaVersion, ContextPackSection, ContextSectionKind, ContextSourceRef, ContextTaskContract, } from './context-pack';
export { ContextCompiler } from './context-compiler';
export type { CompileContextInput, CompileContextResult, ContextCompilerDeps, ContextFactInput, ContextFileInput, } from './context-compiler';
export * from './domain-overlay';
export * from './domain-overlay-presets';
export * from './github-delivery-evidence';
export * from './github-delivery-plan';
export * from './github-delivery-apply';
export * from './orchestration-host-factory';
export * from './tools';
export * from './pyrfor-scoring';
//# sourceMappingURL=index.d.ts.map
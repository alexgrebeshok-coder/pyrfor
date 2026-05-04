/**
 * Runtime HTTP Gateway
 *
 * Thin HTTP server that exposes health/status/chat endpoints for the runtime.
 * Uses Node's built-in `http` module — no framework dependencies.
 */
import type { RuntimeConfig } from './config';
import { type ModelEntry } from './provider-router.js';
import type { HealthMonitor } from './health';
import type { CronService } from './cron';
import type { PyrforRuntime } from './index';
import { GoalStore } from './goal-store';
import type { ApprovalDecision, ApprovalFlowEvent, ApprovalRequest, ResolvedApproval } from './approval-flow';
import type { ArtifactStore } from './artifact-model';
import type { DomainOverlayRegistry } from './domain-overlay';
import type { DurableDag } from './durable-dag';
import type { EventLedger } from './event-ledger';
import type { RunLedger } from './run-ledger';
import type { ConnectorInventorySnapshot, ConnectorStatus } from '../connectors';
export interface GatewayDeps {
    config: RuntimeConfig;
    runtime: PyrforRuntime;
    health?: HealthMonitor;
    cron?: CronService;
    /** Optional GoalStore — defaults to ~/.pyrfor */
    goalStore?: GoalStore;
    /** Optional path to approval-settings.json — defaults to ~/.pyrfor/approval-settings.json */
    approvalSettingsPath?: string;
    /** Optional directory for static Mini App files — defaults to telegram/app/ relative to this module */
    staticDir?: string;
    /** Optional directory for IDE static files — defaults to telegram/ide/ relative to this module */
    ideStaticDir?: string;
    /** Optional directory for chat-attachment storage — defaults to ~/.pyrfor/media */
    mediaDir?: string;
    /**
     * Override exec timeout for testing. Defaults to DEFAULT_EXEC_TIMEOUT_MS (30 s).
     * Set to a small value (e.g., 2000) in tests that verify the timeout path.
     */
    execTimeoutMs?: number;
    /**
     * Override the bind port, taking precedence over `config.gateway.port`.
     * Pass `0` to let the OS assign a random available port.
     * When omitted, the value of the `PYRFOR_PORT` environment variable is checked
     * next (also supports `0`); if absent, `config.gateway.port` is used (default 18790).
     */
    portOverride?: number;
    /** Optional ProviderRouter instance for model listing. Falls back to imported singleton. */
    providerRouter?: {
        listAllModels(): Promise<ModelEntry[]>;
        setActiveModel(provider: string, modelId: string): void;
        getActiveModel(): {
            provider: string;
            modelId: string;
        } | undefined;
        setLocalMode(opts: {
            localFirst: boolean;
            localOnly: boolean;
        }): void;
        getLocalMode(): {
            localFirst: boolean;
            localOnly: boolean;
        };
        refreshFromEnvironment?(): void;
    };
    approvalFlow?: {
        getPending(): ApprovalRequest[];
        resolveDecision(id: string, decision: 'approve' | 'deny'): boolean;
        listAudit(limit?: number): unknown[];
        listAuditByRequestId?(requestId: string, limit?: number): unknown[];
        subscribe?(listener: (event: ApprovalFlowEvent) => void): () => void;
        enqueueApproval?(req: Omit<ApprovalRequest, 'id'> & {
            id?: string;
        }): Promise<ApprovalRequest>;
        getResolvedApproval?(id: string): ResolvedApproval | undefined;
        consumeResolvedApproval?(id: string): ResolvedApproval | undefined;
        recordToolOutcome?(outcome: {
            requestId: string;
            toolName: string;
            summary: string;
            args: Record<string, unknown>;
            decision?: ApprovalDecision;
            resultSummary?: string;
            error?: string;
            undo?: {
                supported: boolean;
                kind?: string;
            };
        }): void;
    };
    orchestration?: {
        runLedger?: Pick<RunLedger, 'listRuns' | 'getRun' | 'replayRun' | 'eventsForRun' | 'transition' | 'completeRun'>;
        eventLedger?: Pick<EventLedger, 'append' | 'readAll' | 'byRun' | 'subscribe'>;
        dag?: Pick<DurableDag, 'listNodes'>;
        artifactStore?: Pick<ArtifactStore, 'list'>;
        overlays?: Pick<DomainOverlayRegistry, 'list' | 'get'>;
    };
    connectorInventory?: {
        getSnapshot(): ConnectorInventorySnapshot;
        probeStatus?(connectorId: string): Promise<ConnectorStatus | null>;
    };
    configPath?: string;
}
export interface GatewayHandle {
    start(): Promise<void>;
    stop(): Promise<void>;
    readonly port: number;
}
/**
 * Exec timeout in milliseconds. Exported so tests can override it via
 * the `execTimeoutMs` field in GatewayDeps.
 */
export declare const DEFAULT_EXEC_TIMEOUT_MS = 30000;
export declare function createRuntimeGateway(deps: GatewayDeps): GatewayHandle;
//# sourceMappingURL=gateway.d.ts.map
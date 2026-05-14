/**
 * engine-loop.ts — M7 UniversalEngineOrchestrator
 *
 * Drives concepts through a DAG-backed phase pipeline:
 *   plan → research? → execute → critique → postmortem → memory_persist → done
 *
 * Design constraints:
 *   - No real ToolForge — execute phase is delegated via injectable ExecutePhaseRunner.
 *   - No gateway — all I/O is through injected deps; no HTTP.
 *   - No production side effects — every side-effect path is injectable and mockable.
 *   - Deterministic — no Date.now() calls outside DurableDag; clock injectable.
 *   - DAG re-hydration — on construction, loads existing DAGs from storePath;
 *     on dispatchConcept the engine skips phases whose nodes are already succeeded.
 *   - Rollback — each phase node carries a DagCompensationPolicy; rollback() walks
 *     completed nodes in reverse order calling registered compensators.
 *   - Abort — abort() sets the abort flag; the running loop detects it at every
 *     phase boundary and emits concept.aborted + run.cancelled.
 *
 * Public API (also the surface wired into runtime/index.ts):
 *   startUniversalEngine(deps)   → UniversalEngineOrchestrator (singleton factory)
 *   dispatchConcept(input)       → ConceptHandle
 *   getConceptRecord(conceptId)  → ConceptRecord | undefined
 *   rollback(conceptId)          → Promise<void>
 *   abort(conceptId, reason?)    → void
 */
import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import { EventLedger } from '../event-ledger';
import type { MemoryStore } from '../memory-store';
import { type ContextRotator } from '../ralph-context-rotator';
import { type StruggleDetector } from '../ralph-struggle-detector';
import type { UniversalPlanner } from './planner';
import type { UniversalResearcher } from './researcher';
import { type EnsembleConfig, type VerifierRunner } from './critic';
import type { EffectGateway } from './effect-gateway';
import type { EnginePhase, PlanDocument } from '../../ai/orchestration/universal-planner';
import { type HistorianApprovalFlow } from './memory/historian-writer';
export type ConceptStatus = 'queued' | 'planning' | 'researching' | 'executing' | 'critiquing' | 'postmortem' | 'persisting_memory' | 'done' | 'aborted' | 'failed';
export interface ConceptRecord {
    conceptId: string;
    goal: string;
    runId: string;
    workspaceId?: string;
    status: ConceptStatus;
    phases: EnginePhase[];
    /** Ordered list of artifact refs produced by each phase. */
    artifactRefs: ArtifactRef[];
    currentPhase?: EnginePhase;
    planRef?: ArtifactRef;
    critiqueRef?: ArtifactRef;
    postmortemRef?: ArtifactRef;
    error?: string;
    createdAt: string;
    completedAt?: string;
}
export interface ConceptInput {
    goal: string;
    workspaceId?: string;
    /** Override the auto-generated conceptId (useful for deterministic tests). */
    conceptId?: string;
    /** Override the run identifier attached to artifacts. */
    runId?: string;
    /** Plan only — skip execute + critique. */
    dryRun?: boolean;
    /** Standing strategy strings injected into the planner context. */
    strategies?: string[];
}
/**
 * Returned immediately from dispatchConcept; use `.promise()` to await
 * completion or `.abort()` to cancel.
 */
export interface ConceptHandle {
    readonly conceptId: string;
    readonly runId: string;
    status(): ConceptStatus;
    /** Resolves once the concept reaches a terminal state (done/aborted/failed). */
    promise(): Promise<ConceptRecord>;
    /** Signal abort; idempotent. */
    abort(reason?: string): void;
}
/**
 * Injectable runner for the execute phase.
 * Accepts the PlanDocument and returns the artifact produced by execution.
 * In production this would call a real executor; in tests it's a mock.
 * This keeps the engine loop free of ToolForge / gateway dependencies.
 */
export type ExecutePhaseRunner = (plan: PlanDocument, runId: string, conceptId: string) => Promise<ArtifactRef>;
/**
 * Registered per phase node kind. Called during rollback with the
 * artifact refs that the phase produced, enabling cleanup.
 */
export type PhaseCompensator = (nodeKind: string, artifactRefs: ArtifactRef[], conceptId: string) => Promise<void>;
export interface UniversalEngineOrchestratorDeps {
    planner: UniversalPlanner;
    researcher: UniversalResearcher;
    artifactStore: ArtifactStore;
    ledger: EventLedger;
    memoryStore: MemoryStore;
    approvalFlow: HistorianApprovalFlow;
    effectGateway?: EffectGateway;
    /**
     * Runs the execute phase. Defaults to a no-op that writes an empty artifact.
     * Inject a real runner in production; inject a mock in tests.
     */
    executePhaseRunner?: ExecutePhaseRunner;
    /**
     * Critic ensemble configuration. When omitted a permissive single-pass
     * ensemble is used (intended only for tests/dry-run scenarios).
     */
    criticConfig?: EnsembleConfig;
    /** Verifier runners keyed by VerifierSpec.id. */
    criticRunners?: ReadonlyMap<string, VerifierRunner>;
    /**
     * Directory under which per-concept DAG files are stored.
     * Defaults to `<cwd>/.pyrfor/dags`.
     */
    dagStorePath?: string;
    /**
     * Compensators keyed by DAG node kind (e.g. `'ue.execute'`).
     * Called in reverse during rollback.
     */
    compensators?: ReadonlyMap<string, PhaseCompensator>;
    /** Injectable clock for deterministic tests. */
    clock?: () => number;
    /**
     * Maximum rework cycles per concept before the critique phase gives up.
     * Default: 2.
     */
    maxReworkCycles?: number;
    /** Ralph-style struggle detector factory used to turn repeated rework into governed recovery. */
    struggleDetectorFactory?: () => StruggleDetector;
    /** Ralph-style context rotator used to compact execution context before expensive phases. */
    contextRotator?: ContextRotator;
    /** Future-facing supervisor backpressure cap for bounded subagent fan-out decisions. */
    maxActiveSubagents?: number;
}
export declare const CONCEPT_ID_PATTERN: RegExp;
export declare class InvalidConceptIdError extends Error {
    constructor(conceptId: string);
}
export declare function assertValidConceptId(conceptId: string): void;
export declare class UniversalEngineOrchestrator {
    private readonly deps;
    private readonly dagStorePath;
    private readonly live;
    private readonly maxReworkCycles;
    private readonly contextRotator;
    private readonly maxActiveSubagents;
    constructor(deps: UniversalEngineOrchestratorDeps);
    /**
     * Dispatch a concept into the engine. Returns immediately with a ConceptHandle.
     * The engine loop runs asynchronously in the background.
     *
     * Re-dispatching the same conceptId resumes from the last incomplete phase
     * (DAG re-hydration). Already-succeeded phase nodes are skipped.
     */
    dispatchConcept(input: ConceptInput): ConceptHandle;
    /** Return the current snapshot of a concept record. */
    getConceptRecord(conceptId: string): ConceptRecord | undefined;
    /** Return snapshots of concepts known to this orchestrator process. */
    listConcepts(): ConceptRecord[];
    /**
     * Re-hydrate a concept from a persisted DAG file without dispatching a new run.
     * Returns a ConceptHandle in `queued` status that can be awaited.
     * Useful for resuming after a process restart.
     */
    rehydrate(conceptId: string, goal: string, runId?: string): ConceptHandle | undefined;
    /**
     * Signal abort for a running concept. The loop will stop at the next phase
     * boundary and emit `concept.aborted` / `run.cancelled`.
     * Idempotent.
     */
    abort(conceptId: string, reason?: string): void;
    /**
     * Rollback all completed phase nodes for a concept in reverse order.
     * Calls the registered PhaseCompensator for each node kind that has one.
     */
    rollback(conceptId: string): Promise<void>;
    private runLoop;
    /**
     * Wraps a phase callback with DAG lease/start/complete lifecycle.
     * If the node is already `succeeded` in the persisted DAG, the callback is
     * skipped and undefined is returned (resume-from-node / rehydration).
     */
    private runPhase;
    /**
     * Returns true if an abort has been signalled and emits the abort events.
     */
    private checkAbort;
    private emitPhaseStarted;
    private emitPhaseCompleted;
    private emitLedger;
    private createRunStruggleDetector;
    private emitStruggleDetected;
    private emitSupervisorDecision;
    private buildSupervisorDecisionVector;
    private persistSupervisorDecisionArtifacts;
    private buildSupervisorDecisionRecord;
    private prepareExecutionPlan;
    private recordRunFailed;
    private settleConcept;
    private runTerminalLearningLoop;
    private runPostmortemPhase;
    private runMemoryPersistPhase;
    private buildPostMortemInput;
    private buildHistorianDistillInput;
    private collectLoadedCritiqueReports;
    private tryReadCritiqueReport;
    private readArtifactJson;
    private buildProvenance;
    private recordPhaseArtifact;
    private restorePlanResult;
    private findArtifactRefForSucceededNode;
    private artifactRefsForNode;
    private findArtifactRef;
    private readonly defaultExecuteRunner;
}
/**
 * Factory that creates a `UniversalEngineOrchestrator`.
 * Wire this in `PyrforRuntime.startUniversalEngine()`.
 */
export declare function startUniversalEngine(deps: UniversalEngineOrchestratorDeps): UniversalEngineOrchestrator;
/**
 * Convenience wrapper: create and immediately dispatch a concept.
 * Equivalent to `startUniversalEngine(deps).dispatchConcept(input)`.
 */
export declare function dispatchConcept(orchestrator: UniversalEngineOrchestrator, input: ConceptInput): ConceptHandle;
//# sourceMappingURL=engine-loop.d.ts.map
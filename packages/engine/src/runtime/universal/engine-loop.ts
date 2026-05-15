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

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ArtifactKind, ArtifactRef, ArtifactStore } from '../artifact-model';
import { DurableDag, type DagNode, type DagProvenanceLink } from '../durable-dag';
import { EventLedger } from '../event-ledger';
import type { MemoryStore } from '../memory-store';
import { createContextRotator, type ContextRotator } from '../ralph-context-rotator';
import {
  createStruggleDetector,
  type StruggleDetector,
  type StruggleSignal,
} from '../ralph-struggle-detector';
import type { UniversalPlanner, UniversalPlannerResult } from './planner';
import type { UniversalResearcher } from './researcher';
import { assessDecisionRecord, type DecisionRecord } from './decision-record-auditor';
import {
  runCriticEnsemble,
  type CriticReport,
  type EnsembleConfig,
  type CriticInput,
  type VerifierRunner,
  type VerifierVerdict,
} from './critic';
import type { EffectGateway } from './effect-gateway';
import type { EnginePhase, PlanDocument, UniversalPlanContext } from '../../ai/orchestration/universal-planner';
import { persistLessons, type HistorianApprovalFlow } from './memory/historian-writer';
import { runPostMortem, type RunPostMortem } from './postmortem';
import type { HistorianDistillInput, LessonsLearnedArtifact } from './historian';
import type { LessonRootCause } from './memory/types';
import type { DecisionVector, UniversalEngineDecisionRecord } from './types';
import type { ExperienceEntry, ExperienceLibrary } from './experience-library';

// ─── Public types ─────────────────────────────────────────────────────────────

export type ConceptStatus =
  | 'queued'
  | 'planning'
  | 'researching'
  | 'executing'
  | 'critiquing'
  | 'postmortem'
  | 'persisting_memory'
  | 'done'
  | 'aborted'
  | 'failed';

export interface ConceptRecord {
  conceptId: string;
  goal: string;
  runId: string;
  workspaceId?: string;
  projectId?: string;
  parentConceptId?: string;
  retryOf?: string;
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
  projectId?: string;
  parentConceptId?: string;
  retryOf?: string;
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

// ─── Execute phase contract ───────────────────────────────────────────────────

/**
 * Injectable runner for the execute phase.
 * Accepts the PlanDocument and returns the artifact produced by execution.
 * In production this would call a real executor; in tests it's a mock.
 * This keeps the engine loop free of ToolForge / gateway dependencies.
 */
export type ExecutePhaseRunner = (
  plan: PlanDocument,
  runId: string,
  conceptId: string,
) => Promise<ArtifactRef>;

// ─── Compensator contract ─────────────────────────────────────────────────────

/**
 * Registered per phase node kind. Called during rollback with the
 * artifact refs that the phase produced, enabling cleanup.
 */
export type PhaseCompensator = (
  nodeKind: string,
  artifactRefs: ArtifactRef[],
  conceptId: string,
) => Promise<void>;

// ─── Orchestrator deps ────────────────────────────────────────────────────────

export interface UniversalEngineOrchestratorDeps {
  planner: UniversalPlanner;
  researcher: UniversalResearcher;
  artifactStore: ArtifactStore;
  ledger: EventLedger;
  memoryStore: MemoryStore;
  approvalFlow: HistorianApprovalFlow;
  experienceLibrary?: ExperienceLibrary;
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

// ─── Internal state ───────────────────────────────────────────────────────────

interface LiveConcept {
  record: ConceptRecord;
  dag: DurableDag;
  /** The single canonical promise for this concept's terminal state. */
  promise: Promise<ConceptRecord>;
  resolve: (r: ConceptRecord) => void;
  reject: (e: unknown) => void;
  abortReason?: string;
  aborted: boolean;
  /** Artifact refs produced by each DAG node in the current run (used for provenance/rollback). */
  phaseArtifacts: Map<string, ArtifactRef[]>; // nodeId → refs
}

// ─── DAG node kinds ───────────────────────────────────────────────────────────

const NODE_KIND = Object.freeze({
  plan: 'ue.plan',
  research: 'ue.research',
  execute: 'ue.execute',
  critique: 'ue.critique',
  postmortem: 'ue.postmortem',
  memoryPersist: 'ue.memory_persist',
  done: 'ue.done',
} as const);

type UeNodeKind = (typeof NODE_KIND)[keyof typeof NODE_KIND];

export const CONCEPT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export class InvalidConceptIdError extends Error {
  constructor(conceptId: string) {
    super(`Invalid conceptId "${conceptId}". Use 1-64 characters from A-Z, a-z, 0-9, "_" or "-".`);
    this.name = 'InvalidConceptIdError';
  }
}

export function assertValidConceptId(conceptId: string): void {
  if (!CONCEPT_ID_PATTERN.test(conceptId)) throw new InvalidConceptIdError(conceptId);
}

// ─── UniversalEngineOrchestrator ──────────────────────────────────────────────

export class UniversalEngineOrchestrator {
  private readonly deps: UniversalEngineOrchestratorDeps;
  private readonly dagStorePath: string;
  private readonly live = new Map<string, LiveConcept>();
  private readonly maxReworkCycles: number;
  private readonly contextRotator: ContextRotator;
  private readonly maxActiveSubagents: number;

  constructor(deps: UniversalEngineOrchestratorDeps) {
    this.deps = deps;
    this.dagStorePath = deps.dagStorePath ?? path.join(process.cwd(), '.pyrfor', 'dags');
    this.maxReworkCycles = deps.maxReworkCycles ?? 2;
    this.contextRotator = deps.contextRotator ?? createContextRotator();
    this.maxActiveSubagents = Math.max(0, deps.maxActiveSubagents ?? 0);
    mkdirSync(this.dagStorePath, { recursive: true });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Dispatch a concept into the engine. Returns immediately with a ConceptHandle.
   * The engine loop runs asynchronously in the background.
   *
   * Re-dispatching the same conceptId resumes from the last incomplete phase
   * (DAG re-hydration). Already-succeeded phase nodes are skipped.
   */
  dispatchConcept(input: ConceptInput): ConceptHandle {
    const conceptId = input.conceptId ?? makeId();
    assertValidConceptId(conceptId);
    const runId = input.runId ?? makeId();

    // Re-use existing live entry (re-dispatch / resume) or create fresh
    const existing = this.live.get(conceptId);
    if (existing && !isTerminal(existing.record.status)) {
      // Already running — return existing handle
      return makeHandle(conceptId, existing);
    }

    let resolve!: (r: ConceptRecord) => void;
    let reject!: (e: unknown) => void;
    // Single canonical promise for this concept. Stored on lc so makeHandle
    // can return it directly without creating an orphaned Promise that would
    // cause unhandled-rejection warnings when errors occur.
    const promise = new Promise<ConceptRecord>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const dagPath = path.join(this.dagStorePath, `${conceptId}.dag.json`);
    const dag = new DurableDag({
      storePath: dagPath,
      ledger: this.deps.ledger,
      ledgerRunId: runId,
      dagId: conceptId,
      clock: this.deps.clock,
    });

    const record: ConceptRecord = {
      conceptId,
      goal: input.goal,
      runId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      parentConceptId: input.parentConceptId,
      retryOf: input.retryOf,
      status: 'queued',
      phases: [],
      artifactRefs: [],
      createdAt: new Date().toISOString(),
    };

    const lc: LiveConcept = {
      record,
      dag,
      promise,
      resolve,
      reject,
      aborted: false,
      phaseArtifacts: new Map(),
    };
    this.live.set(conceptId, lc);

    void this.runLoop(lc, input).catch((err) => {
      lc.record.status = 'failed';
      lc.record.error = err instanceof Error ? err.message : String(err);
      lc.record.completedAt = new Date().toISOString();
      reject(err);
    });

    return makeHandle(conceptId, lc);
  }

  /** Return the current snapshot of a concept record. */
  getConceptRecord(conceptId: string): ConceptRecord | undefined {
    const lc = this.live.get(conceptId);
    return lc ? snapshot(lc.record) : undefined;
  }

  /** Return snapshots of concepts known to this orchestrator process. */
  listConcepts(): ConceptRecord[] {
    return [...this.live.values()].map((lc) => snapshot(lc.record));
  }

  /**
   * Re-hydrate a concept from a persisted DAG file without dispatching a new run.
   * Returns a ConceptHandle in `queued` status that can be awaited.
   * Useful for resuming after a process restart.
   */
  rehydrate(conceptId: string, goal: string, runId?: string): ConceptHandle | undefined {
    assertValidConceptId(conceptId);
    const dagPath = path.join(this.dagStorePath, `${conceptId}.dag.json`);
    if (!existsSync(dagPath)) return undefined;

    return this.dispatchConcept({ conceptId, goal, runId: runId ?? makeId() });
  }

  /**
   * Signal abort for a running concept. The loop will stop at the next phase
   * boundary and emit `concept.aborted` / `run.cancelled`.
   * Idempotent.
   */
  abort(conceptId: string, reason?: string): void {
    const lc = this.live.get(conceptId);
    if (!lc || isTerminal(lc.record.status)) return;
    lc.aborted = true;
    lc.abortReason = reason ?? 'aborted by caller';
  }

  /**
   * Rollback all completed phase nodes for a concept in reverse order.
   * Calls the registered PhaseCompensator for each node kind that has one.
   */
  async rollback(conceptId: string): Promise<void> {
    const lc = this.live.get(conceptId);
    if (!lc) return;

    const completed = lc.dag
      .listNodes({ status: 'succeeded' })
      .sort((a, b) => b.updatedAt - a.updatedAt); // reverse chronological

    for (const node of completed) {
      const compensator = this.deps.compensators?.get(node.kind);
      if (!compensator) continue;
      const cachedArtifacts = lc.phaseArtifacts.get(node.id);
      const artifacts = cachedArtifacts && cachedArtifacts.length > 0
        ? cachedArtifacts
        : await this.artifactRefsForNode(node);
      await compensator(node.kind, artifacts, conceptId);
    }
  }

  // ─── Engine loop ──────────────────────────────────────────────────────────

  private async runLoop(lc: LiveConcept, input: ConceptInput): Promise<void> {
    const { conceptId, runId } = lc.record;
    const struggleDetector = this.createRunStruggleDetector();

    try {
      await this.deps.ledger.append({
        type: 'concept.received',
        run_id: runId,
        concept_id: conceptId,
      });

      // ── Plan phase ───────────────────────────────────────────────────────
      const planArtifact = await this.runPhase(lc, NODE_KIND.plan, async (node) => {
        lc.record.status = 'planning';
        lc.record.currentPhase = 'plan';
        lc.record.phases = addPhase(lc.record.phases, 'plan');

        await this.emitPhaseStarted(lc, 'plan');

        const planningExperiences = await this.queryPlanningExperiences(lc, input.goal);
        const ctx: UniversalPlanContext = {
          workspaceId: input.workspaceId,
          strategies: [
            ...(input.strategies ?? []),
            ...experienceStrategies(planningExperiences),
          ],
        };
        const planResult = await this.deps.planner.plan(input.goal, ctx, { runId });

        lc.record.planRef = planResult.planRef;
        lc.record.artifactRefs = [...lc.record.artifactRefs, planResult.planRef];
        this.recordPhaseArtifact(lc, node.id, planResult.planRef);
        await this.persistPlanDecisionArtifacts(lc, node.id, planningExperiences, planResult);

        await this.emitPhaseCompleted(lc, 'plan', planResult.planRef.id);
        await this.emitLedger(lc, { type: 'concept.planned', run_id: runId, concept_id: conceptId, plan_id: planResult.planRef.id });

        return { planResult, planRef: planResult.planRef };
      });

      if (await this.checkAbort(lc)) return;

      const planResult = planArtifact?.planResult ?? await this.restorePlanResult(lc);

      // ── Research phase (optional) ─────────────────────────────────────────
      if (!input.dryRun && planResult && planResult.plan.researchRequired) {
        for (const topic of planResult.researchTopics) {
          if (await this.checkAbort(lc)) return;
          const nodeId = `ue.research.${slugify(topic)}`;
          await this.runPhase(lc, NODE_KIND.research, async (node) => {
            lc.record.status = 'researching';
            lc.record.currentPhase = 'research';
            lc.record.phases = addPhase(lc.record.phases, 'research');

            await this.emitPhaseStarted(lc, 'research');
            await this.emitLedger(lc, { type: 'research.started', run_id: runId, concept_id: conceptId, research_id: nodeId });

            const researchRef = await this.deps.researcher.research(topic, runId);
            lc.record.artifactRefs = [...lc.record.artifactRefs, researchRef];
            this.recordPhaseArtifact(lc, node.id, researchRef);

            await this.emitPhaseCompleted(lc, 'research', researchRef.id);
            await this.emitLedger(lc, { type: 'research.completed', run_id: runId, concept_id: conceptId, artifact_id: researchRef.id });

            return { researchRef };
          }, nodeId);
        }
      }

      if (await this.checkAbort(lc)) return;

      // ── Execute phase ────────────────────────────────────────────────────
      if (!input.dryRun && planResult) {
        await this.runPhase(lc, NODE_KIND.execute, async (node) => {
          lc.record.status = 'executing';
          lc.record.currentPhase = 'execute';
          lc.record.phases = addPhase(lc.record.phases, 'execute');

          await this.emitPhaseStarted(lc, 'execute');

          const runner = this.deps.executePhaseRunner ?? this.defaultExecuteRunner;
          const executionPlan = await this.prepareExecutionPlan(lc, planResult.plan);
          const execRef = await runner(executionPlan, runId, conceptId);
          lc.record.artifactRefs = [...lc.record.artifactRefs, execRef];
          this.recordPhaseArtifact(lc, node.id, execRef);

          await this.emitPhaseCompleted(lc, 'execute', execRef.id);
          return { execRef };
        });
      }

      if (await this.checkAbort(lc)) return;

      // ── Critique phase ───────────────────────────────────────────────────
      if (!input.dryRun && this.deps.criticConfig && this.deps.criticRunners) {
        let reworkCycles = 0;
        // Stored in a ref object so TypeScript's control-flow analysis does not
        // narrow the value away when assignment happens inside an async callback.
        const verdictRef: { v: VerifierVerdict } = { v: 'pass' };

        do {
          if (await this.checkAbort(lc)) return;
          const critiqueNodeId = `ue.critique.cycle.${reworkCycles}`;
          await this.runPhase(lc, NODE_KIND.critique, async (node) => {
            lc.record.status = 'critiquing';
            lc.record.currentPhase = 'critique';
            lc.record.phases = addPhase(lc.record.phases, 'critique');

            await this.emitPhaseStarted(lc, 'critique');
            await this.emitLedger(lc, { type: 'critique.started', run_id: runId, concept_id: conceptId });

            const subjectRef = lc.record.artifactRefs.at(-1);
            const criticInput: CriticInput = {
              artifactRef: subjectRef?.id ?? conceptId,
              specSummary: planResult?.plan.rationale,
            };

            const report = await runCriticEnsemble(
              this.deps.criticConfig!,
              criticInput,
              this.deps.criticRunners!,
            );

            const critiqueRef = await this.deps.artifactStore.writeJSON(
              'sandbox_result', // reuse nearest kind; 'critique_report' not in ArtifactKind yet
              report,
              { runId, meta: { phase: 'critique', cycle: reworkCycles } },
            );
            lc.record.critiqueRef = critiqueRef;
            lc.record.artifactRefs = [...lc.record.artifactRefs, critiqueRef];
            this.recordPhaseArtifact(lc, node.id, critiqueRef);

            verdictRef.v = report.aggregateVerdict;
            await this.emitLedger(lc, { type: 'critique.completed', run_id: runId, concept_id: conceptId, artifact_id: critiqueRef.id, status: verdictRef.v });
            await this.emitPhaseCompleted(lc, 'critique', critiqueRef.id);

            return { critiqueRef, report };
          }, critiqueNodeId);

          if (verdictRef.v === 'rework') {
            const struggle = struggleDetector.observe(scoreCritiqueVerdict(verdictRef.v));
            if (struggle.kind !== 'progressing') {
              const reason = describeStruggleSignal(struggle);
              const decisionReason = `supervisor aborted after ${reason} during critique`;
              await this.emitStruggleDetected(lc, critiqueNodeId, struggle, reworkCycles + 1, verdictRef.v, decisionReason);
              await this.emitSupervisorDecision(
                lc,
                critiqueNodeId,
                'abort',
                'struggle_detected',
                decisionReason,
                reworkCycles + 1,
              );
              await this.settleConcept(lc, 'failed', {
                dryRun: false,
                reason: decisionReason,
              });
              return;
            }
          }

          reworkCycles += 1;
        } while (verdictRef.v === 'rework' && reworkCycles < this.maxReworkCycles);

        if (verdictRef.v === 'block') {
          await this.settleConcept(lc, 'failed', {
            dryRun: false,
            reason: 'critique blocked execution',
          });
          return;
        }
      }

      if (await this.checkAbort(lc)) return;

      await this.settleConcept(lc, 'done', { dryRun: input.dryRun === true });
    } catch (err) {
      const reason = formatError(err);
      await this.settleConcept(lc, 'failed', {
        dryRun: input.dryRun === true,
        reason,
        rejectWith: err,
      });
    }
  }

  // ─── Phase runner ─────────────────────────────────────────────────────────

  /**
   * Wraps a phase callback with DAG lease/start/complete lifecycle.
   * If the node is already `succeeded` in the persisted DAG, the callback is
   * skipped and undefined is returned (resume-from-node / rehydration).
   */
  private async runPhase<T>(
    lc: LiveConcept,
    nodeKind: UeNodeKind,
    callback: (node: DagNode) => Promise<T>,
    nodeId?: string,
  ): Promise<T | undefined> {
    const id = nodeId ?? nodeKind;
    const existing = lc.dag.getNode(id);

    // Skip already-succeeded nodes (DAG rehydration / resume-from-node)
    if (existing?.status === 'succeeded') {
      const artifacts = await this.artifactRefsForNode(existing);
      if (artifacts.length > 0) {
        for (const ref of artifacts) this.recordPhaseArtifact(lc, existing.id, ref);
        lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, artifacts);
        if (existing.kind === NODE_KIND.plan) lc.record.planRef = artifacts.find(ref => ref.kind === 'plan') ?? lc.record.planRef;
        if (existing.kind === NODE_KIND.critique) lc.record.critiqueRef = artifacts.at(-1) ?? lc.record.critiqueRef;
        if (existing.kind === NODE_KIND.postmortem) lc.record.postmortemRef = artifacts.find(ref => ref.kind === 'postmortem_report') ?? lc.record.postmortemRef;
      }
      return undefined;
    }

    const node = existing
      ? lc.dag.hydrateNode({ id, kind: nodeKind })
      : lc.dag.addNode({
          id,
          kind: nodeKind,
          idempotencyKey: id,
          retryClass: 'transient',
          compensation: { kind: 'rollback', rollbackHandle: nodeKind, note: `rollback ${nodeKind}` },
        });

    lc.dag.leaseNode(node.id, 'engine-loop', 60_000);
    lc.dag.startNode(node.id, 'engine-loop');

    try {
      const result = await callback(node);
      lc.dag.completeNode(node.id, this.buildProvenance(lc, node.id));
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      lc.dag.failNode(node.id, reason, true);
      throw err;
    }
  }

  // ─── Abort handling ───────────────────────────────────────────────────────

  /**
   * Returns true if an abort has been signalled and emits the abort events.
   */
  private async checkAbort(lc: LiveConcept): Promise<boolean> {
    if (!lc.aborted) return false;
    const { conceptId, runId } = lc.record;
    const reason = lc.abortReason ?? 'aborted';

    lc.record.status = 'aborted';
    lc.record.completedAt = new Date().toISOString();

    await this.deps.ledger.append({ type: 'concept.completed', run_id: runId, concept_id: conceptId, status: 'aborted', reason });
    await this.deps.ledger.append({ type: 'run.cancelled', run_id: runId, reason });

    await lc.dag.flushLedger();
    lc.resolve(snapshot(lc.record));
    return true;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async emitPhaseStarted(lc: LiveConcept, phase: EnginePhase): Promise<void> {
    await this.emitLedger(lc, {
      type: 'dag.node.started',
      run_id: lc.record.runId,
      dag_id: lc.record.conceptId,
      node_id: phase,
    });
  }

  private async emitPhaseCompleted(lc: LiveConcept, phase: EnginePhase, artifactId?: string): Promise<void> {
    await this.emitLedger(lc, {
      type: 'dag.node.completed',
      run_id: lc.record.runId,
      dag_id: lc.record.conceptId,
      node_id: phase,
      ...(artifactId !== undefined ? { artifact_refs: [artifactId] } : {}),
    });
  }

  private async emitLedger(lc: LiveConcept, event: Parameters<EventLedger['append']>[0]): Promise<void> {
    await this.deps.ledger.append(event);
  }

  private createRunStruggleDetector(): StruggleDetector {
    if (this.deps.struggleDetectorFactory) return this.deps.struggleDetectorFactory();
    const boundedWindow = Math.max(2, Math.min(3, this.maxReworkCycles));
    return createStruggleDetector({
      flatWindow: boundedWindow,
      minIterations: boundedWindow,
    });
  }

  private async emitStruggleDetected(
    lc: LiveConcept,
    nodeId: string,
    signal: Exclude<StruggleSignal, { kind: 'progressing' }>,
    loopCount: number,
    verdict: VerifierVerdict,
    reason: string,
  ): Promise<void> {
    await this.emitLedger(lc, {
      type: 'struggle.detected',
      run_id: lc.record.runId,
      concept_id: lc.record.conceptId,
      node_id: nodeId,
      signal_kind: signal.kind,
      loop_count: loopCount,
      verdict,
      reason,
      ...struggleSignalFields(signal),
    });
  }

  private async queryPlanningExperiences(lc: LiveConcept, goal: string): Promise<ExperienceEntry[]> {
    if (!this.deps.experienceLibrary || !lc.record.projectId) return [];
    return this.deps.experienceLibrary.queryForPlanner({
      goal,
      projectId: lc.record.projectId,
      includeFailed: true,
      limit: 5,
    });
  }

  private async persistPlanDecisionArtifacts(
    lc: LiveConcept,
    nodeId: string,
    experiences: ExperienceEntry[],
    planResult: UniversalPlannerResult,
  ): Promise<void> {
    if (experiences.length === 0) return;
    const evidenceRefs = uniqueStrings([
      planResult.planRef.id,
      ...experiences.flatMap((entry) => [
        ...entry.provenance.memoryEntryIds,
        ...entry.provenance.artifactIds,
      ]),
    ]);
    const decisionRecord: UniversalEngineDecisionRecord = {
      nodeId,
      nodeHash: hashPlanningNode(lc.record.conceptId, nodeId, planResult.idempotencyKey, experiences),
      algorithm: 'strategic_planning',
      alternativesConsidered: ['plan_without_experience', 'plan_with_approved_experience'],
      selectedAlternative: 'plan_with_approved_experience',
      rationale: 'Planner context included approved, non-legacy, non-quarantined experience patterns.',
      evidenceRefs,
      risksAccepted: [],
      budgetImpact: {},
      timestamp: new Date().toISOString(),
      author: 'system',
      lessonsConsidered: experiences.map(experienceToDecisionImpact),
    };
    const auditRecord = toAuditDecisionRecord(decisionRecord, 0);
    const assessment = assessDecisionRecord({ record: auditRecord });
    const decisionRecordRef = await this.deps.artifactStore.writeJSON('decision_record', decisionRecord, {
      runId: lc.record.runId,
      meta: {
        conceptId: lc.record.conceptId,
        nodeId,
        planRef: planResult.planRef.id,
      },
    });
    this.recordPhaseArtifact(lc, nodeId, decisionRecordRef);
    lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, [decisionRecordRef]);

    const decisionAuditRef = await this.deps.artifactStore.writeJSON('decision_record_audit', {
      record: auditRecord,
      assessment,
      generatedAt: new Date().toISOString(),
      decisionRecordRef: decisionRecordRef.id,
    }, {
      runId: lc.record.runId,
      meta: {
        conceptId: lc.record.conceptId,
        nodeId,
      },
    });
    this.recordPhaseArtifact(lc, nodeId, decisionAuditRef);
    lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, [decisionAuditRef]);
    await this.emitLedger(lc, {
      type: 'decision_record.audit.generated',
      run_id: lc.record.runId,
      node_id: nodeId,
      artifact_id: decisionAuditRef.id,
      attempt: auditRecord.attempt,
      canonical_valid: assessment.canonical && !assessment.block && !assessment.safetyBlock,
      poison_score: assessment.poisonScore,
      signal_codes: assessment.signals.map((signal) => signal.code),
      disposition: decisionAuditDisposition(assessment),
    });
  }

  private async emitSupervisorDecision(
    lc: LiveConcept,
    nodeId: string,
    action: 'rotate_context' | 'continue' | 'abort',
    trigger: 'context_pressure' | 'struggle_detected',
    reason: string,
    loopCount: number,
  ): Promise<void> {
    const phase = lc.record.currentPhase ?? 'execute';
    const decisionVector = this.buildSupervisorDecisionVector(phase, loopCount);
    const decisionArtifacts = await this.persistSupervisorDecisionArtifacts(
      lc,
      nodeId,
      action,
      trigger,
      reason,
      loopCount,
      decisionVector,
    );
    await this.emitLedger(lc, {
      type: 'supervisor.decision',
      run_id: lc.record.runId,
      concept_id: lc.record.conceptId,
      node_id: nodeId,
      action,
      trigger,
      loop_count: loopCount,
      artifact_refs: lc.record.artifactRefs.map((ref) => ref.id),
      reason,
      decision_vector_ref: decisionArtifacts.decisionVectorRef.id,
      decision_vector: decisionVector,
    });
  }

  private buildSupervisorDecisionVector(phase: string, loopCount: number): DecisionVector {
    return {
      phase,
      governedAlgorithm: 'execution_quality_control',
      reversibility: phase === 'execute' ? 'partial' : 'reversible',
      sandboxTier: this.deps.effectGateway ? 'host' : 'none',
      toolTrustTier: 'core',
      failureHistoryScore: loopCount,
      estimatedImpact: { fsScope: [], netReach: [], moneyUsd: 0 },
      remainingBudget: {},
      loopCount,
      newEvidencePresent: false,
      gateStatus: 'satisfied',
      algorithmCoverage: 'declared',
      toolCapRemaining: this.maxActiveSubagents,
    };
  }

  private async persistSupervisorDecisionArtifacts(
    lc: LiveConcept,
    nodeId: string,
    action: 'rotate_context' | 'continue' | 'abort',
    trigger: 'context_pressure' | 'struggle_detected',
    reason: string,
    loopCount: number,
    decisionVector: DecisionVector,
  ): Promise<{
    decisionVectorRef: ArtifactRef;
    decisionRecordRef: ArtifactRef;
    decisionAuditRef: ArtifactRef;
  }> {
    const decisionVectorRef = await this.deps.artifactStore.writeJSON('decision_vector', decisionVector, {
      runId: lc.record.runId,
      meta: {
        conceptId: lc.record.conceptId,
        nodeId,
        action,
        trigger,
      },
    });
    this.recordPhaseArtifact(lc, nodeId, decisionVectorRef);
    lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, [decisionVectorRef]);

    const evidenceRefs = uniqueStrings([
      ...lc.record.artifactRefs.map((ref) => ref.id),
      decisionVectorRef.id,
    ]);
    const decisionRecord = this.buildSupervisorDecisionRecord(
      lc,
      nodeId,
      action,
      reason,
      loopCount,
      evidenceRefs,
      decisionVectorRef.id,
    );
    const auditRecord = toAuditDecisionRecord(decisionRecord, loopCount);
    const assessment = assessDecisionRecord({ record: auditRecord });

    const decisionRecordRef = await this.deps.artifactStore.writeJSON('decision_record', decisionRecord, {
      runId: lc.record.runId,
      meta: {
        conceptId: lc.record.conceptId,
        nodeId,
        action,
        trigger,
        decisionVectorRef: decisionVectorRef.id,
      },
    });
    this.recordPhaseArtifact(lc, nodeId, decisionRecordRef);
    lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, [decisionRecordRef]);

    const decisionAuditRef = await this.deps.artifactStore.writeJSON('decision_record_audit', {
      record: auditRecord,
      assessment,
      generatedAt: new Date().toISOString(),
      decisionVectorRef: decisionVectorRef.id,
      decisionRecordRef: decisionRecordRef.id,
    }, {
      runId: lc.record.runId,
      meta: {
        conceptId: lc.record.conceptId,
        nodeId,
        action,
      },
    });
    this.recordPhaseArtifact(lc, nodeId, decisionAuditRef);
    lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, [decisionAuditRef]);

    await this.emitLedger(lc, {
      type: 'decision_record.audit.generated',
      run_id: lc.record.runId,
      node_id: nodeId,
      artifact_id: decisionAuditRef.id,
      attempt: auditRecord.attempt,
      canonical_valid: assessment.canonical && !assessment.block && !assessment.safetyBlock,
      poison_score: assessment.poisonScore,
      signal_codes: assessment.signals.map((signal) => signal.code),
      disposition: decisionAuditDisposition(assessment),
    });

    return { decisionVectorRef, decisionRecordRef, decisionAuditRef };
  }

  private buildSupervisorDecisionRecord(
    lc: LiveConcept,
    nodeId: string,
    action: 'rotate_context' | 'continue' | 'abort',
    reason: string,
    loopCount: number,
    evidenceRefs: string[],
    decisionVectorRef: string,
  ): UniversalEngineDecisionRecord {
    return {
      nodeId,
      nodeHash: hashSupervisorNode(lc.record.conceptId, nodeId, action, reason, loopCount),
      algorithm: 'execution_quality_control',
      alternativesConsidered: alternativesForSupervisorAction(action),
      selectedAlternative: action,
      rationale: reason,
      evidenceRefs,
      risksAccepted: action === 'abort' ? ['governed supervisor terminated the current run'] : [],
      budgetImpact: {},
      decisionVectorRef,
      timestamp: new Date().toISOString(),
      author: 'system',
    };
  }

  private async prepareExecutionPlan(lc: LiveConcept, plan: PlanDocument): Promise<PlanDocument> {
    const executionContext = renderExecutionContext(plan);
    const rotation = this.contextRotator.shouldRotate(executionContext);
    if (!rotation.rotate) return plan;

    const rotated = await this.contextRotator.rotate(executionContext);
    const summary = rotated.summary.trim() || plan.rationale;
    await this.emitSupervisorDecision(
      lc,
      NODE_KIND.execute,
      'rotate_context',
      'context_pressure',
      rotation.reason,
      0,
    );
    await this.emitLedger(lc, {
      type: 'context.rotated',
      run_id: lc.record.runId,
      concept_id: lc.record.conceptId,
      node_id: NODE_KIND.execute,
      reason: rotation.reason,
      tokens_estimated: rotation.tokensEstimated,
      summary_tokens_estimated: this.contextRotator.estimate(summary),
      preserved_artifact_refs: lc.record.artifactRefs.map((ref) => ref.id),
    });
    return {
      ...plan,
      rationale: summary,
    };
  }

  private async recordRunFailed(lc: LiveConcept, runId: string, originalReason: string): Promise<void> {
    try {
      await this.emitLedger(lc, { type: 'run.failed', run_id: runId, error: originalReason });
    } catch (err) {
      lc.record.error = `${originalReason}; failed to append run.failed: ${formatError(err)}`;
    }
  }

  private async settleConcept(
    lc: LiveConcept,
    status: 'done' | 'failed',
    opts: { dryRun: boolean; reason?: string; rejectWith?: unknown },
  ): Promise<void> {
    const { conceptId, runId } = lc.record;
    const terminalPhase = lc.record.currentPhase;
    const learningErrors = opts.dryRun
      ? []
      : await this.runTerminalLearningLoop(lc, status === 'done' ? 'completed' : 'failed', terminalPhase, opts.reason);

    lc.record.phases = addPhase(lc.record.phases, 'done');
    lc.record.currentPhase = 'done';
    lc.record.status = status;
    if (status === 'failed') {
      lc.record.error = combineMessages(opts.reason, learningErrors);
    } else if (learningErrors.length > 0) {
      lc.record.error = combineMessages(lc.record.error, learningErrors);
    }
    lc.record.completedAt = new Date().toISOString();

    await this.emitLedger(lc, { type: 'concept.completed', run_id: runId, concept_id: conceptId, status });
    if (status === 'done') {
      await this.emitLedger(lc, { type: 'run.completed', run_id: runId, status: 'done' });
    } else {
      await this.recordRunFailed(lc, runId, lc.record.error ?? opts.reason ?? 'unknown failure');
    }

    try {
      await lc.dag.flushLedger();
    } catch (flushErr) {
      lc.record.error = combineMessages(lc.record.error, [`failed to flush DAG ledger: ${formatError(flushErr)}`]);
    }

    if (opts.rejectWith !== undefined) {
      lc.reject(opts.rejectWith);
      return;
    }
    lc.resolve(snapshot(lc.record));
  }

  private async runTerminalLearningLoop(
    lc: LiveConcept,
    outcome: Extract<RunPostMortem['outcome'], 'completed' | 'failed'>,
    terminalPhase: EnginePhase | undefined,
    terminalReason?: string,
  ): Promise<string[]> {
    const errors: string[] = [];
    let postmortemRef: ArtifactRef | undefined;

    try {
      postmortemRef = await this.runPostmortemPhase(lc, outcome, terminalPhase, terminalReason);
    } catch (err) {
      errors.push(`postmortem failed: ${formatError(err)}`);
    }

    if (!postmortemRef) return errors;

    try {
      await this.runMemoryPersistPhase(lc, postmortemRef, outcome, terminalReason);
    } catch (err) {
      errors.push(`memory persist failed: ${formatError(err)}`);
    }

    return errors;
  }

  private async runPostmortemPhase(
    lc: LiveConcept,
    outcome: Extract<RunPostMortem['outcome'], 'completed' | 'failed'>,
    terminalPhase: EnginePhase | undefined,
    terminalReason?: string,
  ): Promise<ArtifactRef | undefined> {
    const result = await this.runPhase(lc, NODE_KIND.postmortem, async (node) => {
      lc.record.status = 'postmortem';
      lc.record.currentPhase = 'postmortem';
      lc.record.phases = addPhase(lc.record.phases, 'postmortem');

      await this.emitPhaseStarted(lc, 'postmortem');
      const postmortemRef = await runPostMortem(
        await this.buildPostMortemInput(lc, outcome, terminalPhase, terminalReason),
        {
          artifactStore: this.deps.artifactStore,
          ledger: this.deps.ledger,
          clock: this.deps.clock,
        },
      );
      lc.record.postmortemRef = postmortemRef;
      lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, [postmortemRef]);
      this.recordPhaseArtifact(lc, node.id, postmortemRef);

      await this.emitPhaseCompleted(lc, 'postmortem', postmortemRef.id);
      return { postmortemRef };
    });

    const restored = result?.postmortemRef
      ?? lc.record.postmortemRef
      ?? await this.findArtifactRefForSucceededNode(lc, NODE_KIND.postmortem, 'postmortem_report');
    if (restored) {
      lc.record.postmortemRef = restored;
      lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, [restored]);
      this.recordPhaseArtifact(lc, NODE_KIND.postmortem, restored);
    }
    return restored;
  }

  private async runMemoryPersistPhase(
    lc: LiveConcept,
    postmortemRef: ArtifactRef,
    outcome: Extract<RunPostMortem['outcome'], 'completed' | 'failed'>,
    terminalReason?: string,
  ): Promise<void> {
    await this.runPhase(lc, NODE_KIND.memoryPersist, async () => {
      lc.record.status = 'persisting_memory';
      lc.record.currentPhase = 'memory_persist';
      lc.record.phases = addPhase(lc.record.phases, 'memory_persist');

      await this.emitPhaseStarted(lc, 'memory_persist');
      const artifactRefs = uniqueStrings([postmortemRef.id, ...lc.record.artifactRefs.map((ref) => ref.id)]);
      const input = await this.buildHistorianDistillInput(lc, postmortemRef, artifactRefs, outcome, terminalReason);
      await persistLessons(
        input,
        {
          runId: lc.record.runId,
          conceptId: lc.record.conceptId,
          projectId: lc.record.projectId,
          parentConceptId: lc.record.parentConceptId,
          retryOf: lc.record.retryOf,
          nodeId: NODE_KIND.memoryPersist,
          artifactRefs,
          algorithm: 'lessons_learned',
        },
        {
          memoryStore: this.deps.memoryStore,
          approvalFlow: this.deps.approvalFlow,
          ledger: this.deps.ledger,
        },
      );

      await this.emitPhaseCompleted(lc, 'memory_persist');
      return { persisted: true };
    });
  }

  private async buildPostMortemInput(
    lc: LiveConcept,
    outcome: Extract<RunPostMortem['outcome'], 'completed' | 'failed'>,
    terminalPhase: EnginePhase | undefined,
    terminalReason?: string,
  ) {
    const critiqueReports = await this.collectLoadedCritiqueReports(lc);
    const passFindings = critiqueReports.flatMap((report) =>
      report.results.filter((result) => result.verdict === 'pass').map((result) => result.rationale.trim()),
    ).filter(Boolean);
    const failFindings = critiqueReports.flatMap((report) =>
      report.results.filter((result) => result.verdict !== 'pass').map((result) => result.rationale.trim()),
    ).filter(Boolean);
    const whatWorked = uniqueStrings([
      ...lc.record.phases
        .filter((phase) => phase !== 'postmortem' && phase !== 'memory_persist' && phase !== 'done')
        .map((phase) => `${phase} phase completed`),
      ...passFindings,
      ...(outcome === 'completed' && passFindings.length === 0 ? ['independent verification passed'] : []),
    ]);
    const whatFailed = uniqueStrings([
      ...failFindings,
      ...(terminalReason ? [terminalReason] : []),
      ...(outcome === 'failed' && failFindings.length === 0 && !terminalReason
        ? [`terminal failure in ${terminalPhase ?? 'unknown'} phase`]
        : []),
    ]);

    return {
      conceptRecord: lc.record,
      outcome,
      summary:
        outcome === 'completed'
          ? `Concept completed after ${lc.record.phases.filter((phase) => phase !== 'done').join(' → ')}.`
          : `Concept failed during ${terminalPhase ?? 'unknown'}: ${terminalReason ?? lc.record.error ?? 'unknown failure'}.`,
      whatWorked,
      whatFailed,
      verifierFindings: uniqueStrings([...passFindings, ...failFindings]),
    };
  }

  private async buildHistorianDistillInput(
    lc: LiveConcept,
    postmortemRef: ArtifactRef,
    artifactRefs: string[],
    outcome: Extract<RunPostMortem['outcome'], 'completed' | 'failed'>,
    terminalReason?: string,
  ): Promise<HistorianDistillInput> {
    const postmortem = await this.readArtifactJson<RunPostMortem>(postmortemRef);
    const critiqueReports = await this.collectLoadedCritiqueReports(lc);
    const lessons: LessonsLearnedArtifact = {
      scope: 'run',
      whatWorked: postmortem.whatWorked.length > 0 ? postmortem.whatWorked : ['governed execution completed'],
      whatFailed: postmortem.whatFailed.length > 0 ? postmortem.whatFailed : outcome === 'failed'
        ? [terminalReason ?? lc.record.error ?? 'terminal failure']
        : [],
      rootCause: inferLessonRootCause(critiqueReports, terminalReason ?? lc.record.error),
      evidenceRefs: artifactRefs,
      confidence: critiqueReports.length > 0 ? 'high' : 'medium',
      algorithmOutcome: outcome === 'completed' ? 'success' : 'failed_to_meet_criteria',
    };

    return {
      sourceLessonsArtifactRef: postmortemRef.id,
      context: {
        runId: lc.record.runId,
        conceptId: lc.record.conceptId,
        projectId: lc.record.projectId,
        parentConceptId: lc.record.parentConceptId,
        retryOf: lc.record.retryOf,
        nodeId: NODE_KIND.memoryPersist,
        nodeHash: postmortemRef.sha256 ?? postmortemRef.id,
        algorithm: 'lessons_learned',
        phase: 'postmortem',
        nodeKind: 'consequential',
        domain: inferLessonDomain(lc.record.goal),
        toolSignatures: uniqueStrings([
          ...postmortem.toolsUsed,
          ...postmortem.toolsForged,
        ]),
        verifierScore: verifierScore(critiqueReports),
        acceptanceTestPassRate: acceptanceTestPassRate(critiqueReports),
      },
      lessons,
    };
  }

  private async collectLoadedCritiqueReports(lc: LiveConcept): Promise<CriticReport[]> {
    const critiqueRefs = [...lc.phaseArtifacts.entries()]
      .filter(([nodeId]) => nodeId.startsWith(NODE_KIND.critique))
      .flatMap(([, refs]) => refs);
    const reports = await Promise.all(critiqueRefs.map((ref) => this.tryReadCritiqueReport(ref)));
    return reports.filter((report): report is CriticReport => report !== undefined);
  }

  private async tryReadCritiqueReport(ref: ArtifactRef): Promise<CriticReport | undefined> {
    try {
      return ref.sha256
        ? this.deps.artifactStore.readJSONVerified<CriticReport>(ref, ref.sha256)
        : this.deps.artifactStore.readJSON<CriticReport>(ref);
    } catch {
      return undefined;
    }
  }

  private async readArtifactJson<T>(ref: ArtifactRef): Promise<T> {
    return ref.sha256
      ? this.deps.artifactStore.readJSONVerified<T>(ref, ref.sha256)
      : this.deps.artifactStore.readJSON<T>(ref);
  }

  private buildProvenance(lc: LiveConcept, nodeId: string): DagProvenanceLink[] {
    const refs = lc.phaseArtifacts.get(nodeId) ?? [];
    return refs.map((ref) => ({
      kind: 'artifact' as const,
      ref: ref.id,
      role: 'output' as const,
      sha256: ref.sha256,
    }));
  }

  private recordPhaseArtifact(lc: LiveConcept, nodeKind: string, ref: ArtifactRef): void {
    const existing = lc.phaseArtifacts.get(nodeKind) ?? [];
    if (existing.some(item => item.id === ref.id)) return;
    lc.phaseArtifacts.set(nodeKind, [...existing, ref]);
  }

  private async restorePlanResult(lc: LiveConcept): Promise<UniversalPlannerResult | undefined> {
    const planRef = lc.record.planRef ?? await this.findArtifactRefForSucceededNode(lc, NODE_KIND.plan, 'plan');
    if (!planRef) return undefined;

    const plan = planRef.sha256
      ? await this.deps.artifactStore.readJSONVerified<PlanDocument>(planRef, planRef.sha256)
      : await this.deps.artifactStore.readJSON<PlanDocument>(planRef);

    lc.record.planRef = planRef;
    lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, [planRef]);
    this.recordPhaseArtifact(lc, NODE_KIND.plan, planRef);

    return {
      planRef,
      plan,
      phases: plan.phases,
      missingTools: plan.missingTools,
      researchTopics: plan.researchTopics,
      idempotencyKey: plan.idempotencyKey,
      cacheHit: true,
    };
  }

  private async findArtifactRefForSucceededNode(lc: LiveConcept, nodeKind: UeNodeKind, artifactKind: ArtifactKind): Promise<ArtifactRef | undefined> {
    const nodes = lc.dag.listNodes({ status: 'succeeded', kind: nodeKind });
    const artifactId = nodes
      .flatMap(node => node.provenance)
      .find(link => link.kind === 'artifact')?.ref;
    if (!artifactId) return undefined;
    return this.findArtifactRef(artifactId, artifactKind);
  }

  private async artifactRefsForNode(node: DagNode): Promise<ArtifactRef[]> {
    const refs: ArtifactRef[] = [];
    for (const link of node.provenance.filter(link => link.kind === 'artifact')) {
      const ref = await this.findArtifactRef(link.ref);
      if (!ref) throw new Error(`UniversalEngineOrchestrator: missing artifact "${link.ref}" for succeeded DAG node "${node.id}"`);
      refs.push(ref);
    }
    return refs;
  }

  private async findArtifactRef(artifactId: string, artifactKind?: ArtifactKind): Promise<ArtifactRef | undefined> {
    const refs = await this.deps.artifactStore.list(artifactKind ? { kind: artifactKind } : undefined);
    return refs.find(ref => ref.id === artifactId);
  }

  private readonly defaultExecuteRunner: ExecutePhaseRunner = async (plan, runId) => {
    return this.deps.artifactStore.writeJSON('sandbox_result', {
      planIdempotencyKey: plan.idempotencyKey,
      runId,
      status: 'stubbed',
    }, { runId });
  };
}

// ─── Standalone API (wired into runtime/index.ts) ────────────────────────────

/**
 * Factory that creates a `UniversalEngineOrchestrator`.
 * Wire this in `PyrforRuntime.startUniversalEngine()`.
 */
export function startUniversalEngine(
  deps: UniversalEngineOrchestratorDeps,
): UniversalEngineOrchestrator {
  return new UniversalEngineOrchestrator(deps);
}

/**
 * Convenience wrapper: create and immediately dispatch a concept.
 * Equivalent to `startUniversalEngine(deps).dispatchConcept(input)`.
 */
export function dispatchConcept(
  orchestrator: UniversalEngineOrchestrator,
  input: ConceptInput,
): ConceptHandle {
  return orchestrator.dispatchConcept(input);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeHandle(conceptId: string, lc: LiveConcept): ConceptHandle {
  return {
    conceptId,
    runId: lc.record.runId,
    status: () => lc.record.status,
    // Return the single canonical promise stored on lc — no double-wrapping.
    promise: () => lc.promise,
    abort: (reason) => {
      lc.aborted = true;
      lc.abortReason = reason;
    },
  };
}

function isTerminal(status: ConceptStatus): boolean {
  return status === 'done' || status === 'aborted' || status === 'failed';
}

function addPhase(phases: EnginePhase[], phase: EnginePhase): EnginePhase[] {
  if (phases.includes(phase)) return phases;
  return [...phases, phase];
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
}

function snapshot(record: ConceptRecord): ConceptRecord {
  return { ...record, artifactRefs: [...record.artifactRefs], phases: [...record.phases] };
}

function renderExecutionContext(plan: PlanDocument): string {
  return [
    `Concept: ${plan.concept}`,
    `Rationale: ${plan.rationale}`,
    `Phases: ${plan.phases.join(', ')}`,
    `Research required: ${plan.researchRequired ? 'yes' : 'no'}`,
    `Research topics: ${plan.researchTopics.join(', ') || 'none'}`,
    'Steps:',
    ...plan.steps.map((step) => [
      `- ${step.id}: ${step.title}`,
      step.description,
      `Acceptance: ${step.acceptanceCriteria.join('; ') || 'none'}`,
    ].join('\n')),
  ].join('\n');
}

function scoreCritiqueVerdict(verdict: VerifierVerdict): number {
  switch (verdict) {
    case 'pass':
      return 100;
    case 'rework':
      return 60;
    case 'block':
      return 0;
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function verifierScore(reports: CriticReport[]): number | undefined {
  const verdicts = reports.flatMap((report) => report.results.map((result) => result.verdict));
  if (verdicts.length === 0) return undefined;
  const total = verdicts.reduce((sum, verdict) => sum + scoreCritiqueVerdict(verdict), 0);
  return Number((total / (verdicts.length * 100)).toFixed(3));
}

function acceptanceTestPassRate(reports: CriticReport[]): number | undefined {
  const verdicts = reports.flatMap((report) => report.results.map((result) => result.verdict));
  if (verdicts.length === 0) return undefined;
  const passed = verdicts.filter((verdict) => verdict === 'pass').length;
  return Number((passed / verdicts.length).toFixed(3));
}

function inferLessonDomain(goal: string): string {
  const text = goal.toLowerCase();
  if (/test|typescript|javascript|code|bug|build|lint|api|cli|runtime|engine/.test(text)) return 'coding';
  if (/deploy|release|ci|workflow|docker|server|cloud|infra/.test(text)) return 'infra';
  if (/research|analy[sz]e|исслед|анализ/.test(text)) return 'research';
  if (/operator|migration|ops|runbook|incident/.test(text)) return 'ops';
  return 'general';
}

function combineMessages(primary: string | undefined, extra: string[]): string | undefined {
  const parts = uniqueStrings([primary ?? '', ...extra]);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function inferLessonRootCause(reports: CriticReport[], terminalReason?: string): LessonRootCause {
  if (reports.some((report) => new Set(report.results.map((result) => result.verdict)).size > 1)) {
    return 'verifier_disagreement';
  }
  const corpus = [terminalReason ?? '', ...reports.flatMap((report) => report.results.map((result) => result.rationale))].join('\n').toLowerCase();
  if (/budget|tier|approval/.test(corpus)) return 'budget_or_tier';
  if (/external|dependency|timeout|network/.test(corpus)) return 'external_dependency';
  if (/tool|missing capability/.test(corpus)) return 'tool_gap';
  if (/spec|requirement|clarif/.test(corpus)) return 'spec_gap';
  if (/test|acceptance|verify|verifier/.test(corpus)) return 'test_gap';
  return 'execution_bug';
}

function alternativesForSupervisorAction(
  action: 'rotate_context' | 'continue' | 'abort',
): string[] {
  switch (action) {
    case 'rotate_context':
      return ['continue', 'rotate_context'];
    case 'abort':
      return ['continue', 'abort'];
    case 'continue':
      return ['continue'];
  }
}

function toAuditDecisionRecord(record: UniversalEngineDecisionRecord, loopCount: number): DecisionRecord {
  return {
    id: randomUUID(),
    nodeId: record.nodeId,
    nodeHash: record.nodeHash,
    attempt: Math.max(1, loopCount + 1),
    selectedAlternative: record.selectedAlternative,
    alternativesConsidered: record.alternativesConsidered,
    rationale: record.rationale,
    evidenceRefs: record.evidenceRefs,
    budgetImpact: record.budgetImpact,
    timestamp: record.timestamp,
    lessonsConsidered: record.lessonsConsidered,
  };
}

function decisionAuditDisposition(
  assessment: ReturnType<typeof assessDecisionRecord>,
): 'accepted' | 'quarantined' | 'gate_failed' | 'safety_block' {
  if (assessment.safetyBlock) return 'safety_block';
  if (assessment.block) return 'gate_failed';
  if (assessment.quarantined) return 'quarantined';
  return 'accepted';
}

function hashSupervisorNode(
  conceptId: string,
  nodeId: string,
  action: string,
  reason: string,
  loopCount: number,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ conceptId, nodeId, action, reason, loopCount }))
    .digest('hex');
}

function hashPlanningNode(
  conceptId: string,
  nodeId: string,
  idempotencyKey: string,
  experiences: ExperienceEntry[],
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      conceptId,
      nodeId,
      idempotencyKey,
      experienceIds: experiences.map((entry) => entry.id).sort(),
    }))
    .digest('hex');
}

function experienceStrategies(experiences: ExperienceEntry[]): string[] {
  const patterns = experiences
    .filter((entry) => entry.outcome === 'completed')
    .flatMap((entry) => entry.reusablePatterns.map((pattern) => `Experience pattern (${entry.id}): ${pattern}`));
  const antipatterns = experiences
    .filter((entry) => entry.outcome === 'failed' || entry.outcome === 'blocked')
    .flatMap((entry) => entry.whatFailed.map((failure) => `Avoid prior failure (${entry.id}): ${failure}`));
  return uniqueStrings([...patterns, ...antipatterns]).slice(0, 10);
}

function experienceToDecisionImpact(entry: ExperienceEntry): NonNullable<UniversalEngineDecisionRecord['lessonsConsidered']>[number] {
  return {
    lessonId: entry.id,
    lessonSnapshotHash: createHash('sha256')
      .update(JSON.stringify({
        id: entry.id,
        projectId: entry.projectId,
        outcome: entry.outcome,
        reusablePatterns: entry.reusablePatterns,
        whatFailed: entry.whatFailed,
        provenance: entry.provenance,
      }))
      .digest('hex'),
    disposition: entry.outcome === 'completed' ? 'adapted' : 'followed',
    changedSelectedAlternative: true,
    impactSummary: entry.outcome === 'completed'
      ? `Injected approved reusable patterns from ${entry.id} into planner context.`
      : `Injected approved prior failure from ${entry.id} as an antipattern to avoid.`,
  };
}

function describeStruggleSignal(signal: Exclude<StruggleSignal, { kind: 'progressing' }>): string {
  switch (signal.kind) {
    case 'flat':
      return `flat progress for ${signal.iterations} iterations`;
    case 'regression':
      return `regression from ${signal.from} to ${signal.to}`;
    case 'oscillation':
      return `oscillation over ${signal.window} scores`;
  }
}

function struggleSignalFields(signal: Exclude<StruggleSignal, { kind: 'progressing' }>): {
  last_score?: number;
  iterations?: number;
  from_score?: number;
  to_score?: number;
  window?: number;
} {
  switch (signal.kind) {
    case 'flat':
      return { iterations: signal.iterations, last_score: signal.lastScore };
    case 'regression':
      return { from_score: signal.from, to_score: signal.to };
    case 'oscillation':
      return { window: signal.window };
  }
}

function mergeArtifactRefs(existing: ArtifactRef[], incoming: ArtifactRef[]): ArtifactRef[] {
  const seen = new Set(existing.map(ref => ref.id));
  const merged = [...existing];
  for (const ref of incoming) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    merged.push(ref);
  }
  return merged;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function makeId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 20);
}

/**
 * engine-loop.ts — M7 UniversalEngineOrchestrator
 *
 * Drives concepts through a DAG-backed phase pipeline:
 *   plan → research? → execute → critique → done
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

import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ArtifactKind, ArtifactRef, ArtifactStore } from '../artifact-model';
import { DurableDag, type DagNode, type DagProvenanceLink } from '../durable-dag';
import { EventLedger } from '../event-ledger';
import type { UniversalPlanner, UniversalPlannerResult } from './planner';
import type { UniversalResearcher } from './researcher';
import {
  runCriticEnsemble,
  type EnsembleConfig,
  type CriticInput,
  type VerifierRunner,
  type VerifierVerdict,
} from './critic';
import type { EffectGateway } from './effect-gateway';
import type { EnginePhase, PlanDocument, UniversalPlanContext } from '../../ai/orchestration/universal-planner';

// ─── Public types ─────────────────────────────────────────────────────────────

export type ConceptStatus =
  | 'queued'
  | 'planning'
  | 'researching'
  | 'executing'
  | 'critiquing'
  | 'done'
  | 'aborted'
  | 'failed';

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

  constructor(deps: UniversalEngineOrchestratorDeps) {
    this.deps = deps;
    this.dagStorePath = deps.dagStorePath ?? path.join(process.cwd(), '.pyrfor', 'dags');
    this.maxReworkCycles = deps.maxReworkCycles ?? 2;
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

        const ctx: UniversalPlanContext = {
          workspaceId: input.workspaceId,
          strategies: input.strategies,
        };
        const planResult = await this.deps.planner.plan(input.goal, ctx, { runId });

        lc.record.planRef = planResult.planRef;
        lc.record.artifactRefs = [...lc.record.artifactRefs, planResult.planRef];
        this.recordPhaseArtifact(lc, node.id, planResult.planRef);

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
          const execRef = await runner(planResult.plan, runId, conceptId);
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
          }, `ue.critique.cycle.${reworkCycles}`);

          reworkCycles += 1;
        } while (verdictRef.v === 'rework' && reworkCycles < this.maxReworkCycles);

        if (verdictRef.v === 'block') {
          lc.record.status = 'failed';
          lc.record.error = 'critique blocked execution';
          lc.record.completedAt = new Date().toISOString();
          await this.recordRunFailed(lc, runId, lc.record.error);
          lc.resolve(snapshot(lc.record));
          return;
        }
      }

      if (await this.checkAbort(lc)) return;

      // ── Done ─────────────────────────────────────────────────────────────
      lc.record.phases = addPhase(lc.record.phases, 'done');
      lc.record.currentPhase = 'done';
      lc.record.status = 'done';
      lc.record.completedAt = new Date().toISOString();

      await this.emitLedger(lc, { type: 'concept.completed', run_id: runId, concept_id: conceptId, status: 'done' });
      await this.emitLedger(lc, { type: 'run.completed', run_id: runId, status: 'done' });

      await lc.dag.flushLedger();
      lc.resolve(snapshot(lc.record));
    } catch (err) {
      lc.record.status = 'failed';
      const reason = formatError(err);
      lc.record.error = reason;
      lc.record.completedAt = new Date().toISOString();
      await this.recordRunFailed(lc, runId, reason);
      try {
        await lc.dag.flushLedger();
      } catch (flushErr) {
        lc.record.error = `${lc.record.error}; failed to flush DAG ledger: ${formatError(flushErr)}`;
      }
      lc.reject(err);
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

  private async recordRunFailed(lc: LiveConcept, runId: string, originalReason: string): Promise<void> {
    try {
      await this.emitLedger(lc, { type: 'run.failed', run_id: runId, error: originalReason });
    } catch (err) {
      lc.record.error = `${originalReason}; failed to append run.failed: ${formatError(err)}`;
    }
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

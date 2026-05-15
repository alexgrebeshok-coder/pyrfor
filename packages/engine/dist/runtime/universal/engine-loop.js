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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DurableDag } from '../durable-dag.js';
import { createContextRotator } from '../ralph-context-rotator.js';
import { createStruggleDetector, } from '../ralph-struggle-detector.js';
import { assessDecisionRecord } from './decision-record-auditor.js';
import { runCriticEnsemble, } from './critic.js';
import { persistLessons } from './memory/historian-writer.js';
import { runPostMortem } from './postmortem.js';
// ─── DAG node kinds ───────────────────────────────────────────────────────────
const NODE_KIND = Object.freeze({
    plan: 'ue.plan',
    research: 'ue.research',
    execute: 'ue.execute',
    critique: 'ue.critique',
    postmortem: 'ue.postmortem',
    memoryPersist: 'ue.memory_persist',
    done: 'ue.done',
});
export const CONCEPT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export class InvalidConceptIdError extends Error {
    constructor(conceptId) {
        super(`Invalid conceptId "${conceptId}". Use 1-64 characters from A-Z, a-z, 0-9, "_" or "-".`);
        this.name = 'InvalidConceptIdError';
    }
}
export function assertValidConceptId(conceptId) {
    if (!CONCEPT_ID_PATTERN.test(conceptId))
        throw new InvalidConceptIdError(conceptId);
}
// ─── UniversalEngineOrchestrator ──────────────────────────────────────────────
export class UniversalEngineOrchestrator {
    constructor(deps) {
        var _a, _b, _c, _d;
        this.live = new Map();
        this.defaultExecuteRunner = (plan, runId) => __awaiter(this, void 0, void 0, function* () {
            return this.deps.artifactStore.writeJSON('sandbox_result', {
                planIdempotencyKey: plan.idempotencyKey,
                runId,
                status: 'stubbed',
            }, { runId });
        });
        this.deps = deps;
        this.dagStorePath = (_a = deps.dagStorePath) !== null && _a !== void 0 ? _a : path.join(process.cwd(), '.pyrfor', 'dags');
        this.maxReworkCycles = (_b = deps.maxReworkCycles) !== null && _b !== void 0 ? _b : 2;
        this.contextRotator = (_c = deps.contextRotator) !== null && _c !== void 0 ? _c : createContextRotator();
        this.maxActiveSubagents = Math.max(0, (_d = deps.maxActiveSubagents) !== null && _d !== void 0 ? _d : 0);
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
    dispatchConcept(input) {
        var _a, _b;
        const conceptId = (_a = input.conceptId) !== null && _a !== void 0 ? _a : makeId();
        assertValidConceptId(conceptId);
        const runId = (_b = input.runId) !== null && _b !== void 0 ? _b : makeId();
        // Re-use existing live entry (re-dispatch / resume) or create fresh
        const existing = this.live.get(conceptId);
        if (existing && !isTerminal(existing.record.status)) {
            // Already running — return existing handle
            return makeHandle(conceptId, existing);
        }
        let resolve;
        let reject;
        // Single canonical promise for this concept. Stored on lc so makeHandle
        // can return it directly without creating an orphaned Promise that would
        // cause unhandled-rejection warnings when errors occur.
        const promise = new Promise((res, rej) => {
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
        const record = {
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
        const lc = {
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
    getConceptRecord(conceptId) {
        const lc = this.live.get(conceptId);
        return lc ? snapshot(lc.record) : undefined;
    }
    /** Return snapshots of concepts known to this orchestrator process. */
    listConcepts() {
        return [...this.live.values()].map((lc) => snapshot(lc.record));
    }
    /**
     * Re-hydrate a concept from a persisted DAG file without dispatching a new run.
     * Returns a ConceptHandle in `queued` status that can be awaited.
     * Useful for resuming after a process restart.
     */
    rehydrate(conceptId, goal, runId) {
        assertValidConceptId(conceptId);
        const dagPath = path.join(this.dagStorePath, `${conceptId}.dag.json`);
        if (!existsSync(dagPath))
            return undefined;
        return this.dispatchConcept({ conceptId, goal, runId: runId !== null && runId !== void 0 ? runId : makeId() });
    }
    /**
     * Signal abort for a running concept. The loop will stop at the next phase
     * boundary and emit `concept.aborted` / `run.cancelled`.
     * Idempotent.
     */
    abort(conceptId, reason) {
        const lc = this.live.get(conceptId);
        if (!lc || isTerminal(lc.record.status))
            return;
        lc.aborted = true;
        lc.abortReason = reason !== null && reason !== void 0 ? reason : 'aborted by caller';
    }
    /**
     * Rollback all completed phase nodes for a concept in reverse order.
     * Calls the registered PhaseCompensator for each node kind that has one.
     */
    rollback(conceptId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const lc = this.live.get(conceptId);
            if (!lc)
                return;
            const completed = lc.dag
                .listNodes({ status: 'succeeded' })
                .sort((a, b) => b.updatedAt - a.updatedAt); // reverse chronological
            for (const node of completed) {
                const compensator = (_a = this.deps.compensators) === null || _a === void 0 ? void 0 : _a.get(node.kind);
                if (!compensator)
                    continue;
                const cachedArtifacts = lc.phaseArtifacts.get(node.id);
                const artifacts = cachedArtifacts && cachedArtifacts.length > 0
                    ? cachedArtifacts
                    : yield this.artifactRefsForNode(node);
                yield compensator(node.kind, artifacts, conceptId);
            }
        });
    }
    // ─── Engine loop ──────────────────────────────────────────────────────────
    runLoop(lc, input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const { conceptId, runId } = lc.record;
            const struggleDetector = this.createRunStruggleDetector();
            try {
                yield this.deps.ledger.append({
                    type: 'concept.received',
                    run_id: runId,
                    concept_id: conceptId,
                });
                // ── Plan phase ───────────────────────────────────────────────────────
                const planArtifact = yield this.runPhase(lc, NODE_KIND.plan, (node) => __awaiter(this, void 0, void 0, function* () {
                    lc.record.status = 'planning';
                    lc.record.currentPhase = 'plan';
                    lc.record.phases = addPhase(lc.record.phases, 'plan');
                    yield this.emitPhaseStarted(lc, 'plan');
                    const ctx = {
                        workspaceId: input.workspaceId,
                        strategies: input.strategies,
                    };
                    const planResult = yield this.deps.planner.plan(input.goal, ctx, { runId });
                    lc.record.planRef = planResult.planRef;
                    lc.record.artifactRefs = [...lc.record.artifactRefs, planResult.planRef];
                    this.recordPhaseArtifact(lc, node.id, planResult.planRef);
                    yield this.emitPhaseCompleted(lc, 'plan', planResult.planRef.id);
                    yield this.emitLedger(lc, { type: 'concept.planned', run_id: runId, concept_id: conceptId, plan_id: planResult.planRef.id });
                    return { planResult, planRef: planResult.planRef };
                }));
                if (yield this.checkAbort(lc))
                    return;
                const planResult = (_a = planArtifact === null || planArtifact === void 0 ? void 0 : planArtifact.planResult) !== null && _a !== void 0 ? _a : yield this.restorePlanResult(lc);
                // ── Research phase (optional) ─────────────────────────────────────────
                if (!input.dryRun && planResult && planResult.plan.researchRequired) {
                    for (const topic of planResult.researchTopics) {
                        if (yield this.checkAbort(lc))
                            return;
                        const nodeId = `ue.research.${slugify(topic)}`;
                        yield this.runPhase(lc, NODE_KIND.research, (node) => __awaiter(this, void 0, void 0, function* () {
                            lc.record.status = 'researching';
                            lc.record.currentPhase = 'research';
                            lc.record.phases = addPhase(lc.record.phases, 'research');
                            yield this.emitPhaseStarted(lc, 'research');
                            yield this.emitLedger(lc, { type: 'research.started', run_id: runId, concept_id: conceptId, research_id: nodeId });
                            const researchRef = yield this.deps.researcher.research(topic, runId);
                            lc.record.artifactRefs = [...lc.record.artifactRefs, researchRef];
                            this.recordPhaseArtifact(lc, node.id, researchRef);
                            yield this.emitPhaseCompleted(lc, 'research', researchRef.id);
                            yield this.emitLedger(lc, { type: 'research.completed', run_id: runId, concept_id: conceptId, artifact_id: researchRef.id });
                            return { researchRef };
                        }), nodeId);
                    }
                }
                if (yield this.checkAbort(lc))
                    return;
                // ── Execute phase ────────────────────────────────────────────────────
                if (!input.dryRun && planResult) {
                    yield this.runPhase(lc, NODE_KIND.execute, (node) => __awaiter(this, void 0, void 0, function* () {
                        var _a;
                        lc.record.status = 'executing';
                        lc.record.currentPhase = 'execute';
                        lc.record.phases = addPhase(lc.record.phases, 'execute');
                        yield this.emitPhaseStarted(lc, 'execute');
                        const runner = (_a = this.deps.executePhaseRunner) !== null && _a !== void 0 ? _a : this.defaultExecuteRunner;
                        const executionPlan = yield this.prepareExecutionPlan(lc, planResult.plan);
                        const execRef = yield runner(executionPlan, runId, conceptId);
                        lc.record.artifactRefs = [...lc.record.artifactRefs, execRef];
                        this.recordPhaseArtifact(lc, node.id, execRef);
                        yield this.emitPhaseCompleted(lc, 'execute', execRef.id);
                        return { execRef };
                    }));
                }
                if (yield this.checkAbort(lc))
                    return;
                // ── Critique phase ───────────────────────────────────────────────────
                if (!input.dryRun && this.deps.criticConfig && this.deps.criticRunners) {
                    let reworkCycles = 0;
                    // Stored in a ref object so TypeScript's control-flow analysis does not
                    // narrow the value away when assignment happens inside an async callback.
                    const verdictRef = { v: 'pass' };
                    do {
                        if (yield this.checkAbort(lc))
                            return;
                        const critiqueNodeId = `ue.critique.cycle.${reworkCycles}`;
                        yield this.runPhase(lc, NODE_KIND.critique, (node) => __awaiter(this, void 0, void 0, function* () {
                            var _a;
                            lc.record.status = 'critiquing';
                            lc.record.currentPhase = 'critique';
                            lc.record.phases = addPhase(lc.record.phases, 'critique');
                            yield this.emitPhaseStarted(lc, 'critique');
                            yield this.emitLedger(lc, { type: 'critique.started', run_id: runId, concept_id: conceptId });
                            const subjectRef = lc.record.artifactRefs.at(-1);
                            const criticInput = {
                                artifactRef: (_a = subjectRef === null || subjectRef === void 0 ? void 0 : subjectRef.id) !== null && _a !== void 0 ? _a : conceptId,
                                specSummary: planResult === null || planResult === void 0 ? void 0 : planResult.plan.rationale,
                            };
                            const report = yield runCriticEnsemble(this.deps.criticConfig, criticInput, this.deps.criticRunners);
                            const critiqueRef = yield this.deps.artifactStore.writeJSON('sandbox_result', // reuse nearest kind; 'critique_report' not in ArtifactKind yet
                            report, { runId, meta: { phase: 'critique', cycle: reworkCycles } });
                            lc.record.critiqueRef = critiqueRef;
                            lc.record.artifactRefs = [...lc.record.artifactRefs, critiqueRef];
                            this.recordPhaseArtifact(lc, node.id, critiqueRef);
                            verdictRef.v = report.aggregateVerdict;
                            yield this.emitLedger(lc, { type: 'critique.completed', run_id: runId, concept_id: conceptId, artifact_id: critiqueRef.id, status: verdictRef.v });
                            yield this.emitPhaseCompleted(lc, 'critique', critiqueRef.id);
                            return { critiqueRef, report };
                        }), critiqueNodeId);
                        if (verdictRef.v === 'rework') {
                            const struggle = struggleDetector.observe(scoreCritiqueVerdict(verdictRef.v));
                            if (struggle.kind !== 'progressing') {
                                const reason = describeStruggleSignal(struggle);
                                const decisionReason = `supervisor aborted after ${reason} during critique`;
                                yield this.emitStruggleDetected(lc, critiqueNodeId, struggle, reworkCycles + 1, verdictRef.v, decisionReason);
                                yield this.emitSupervisorDecision(lc, critiqueNodeId, 'abort', 'struggle_detected', decisionReason, reworkCycles + 1);
                                yield this.settleConcept(lc, 'failed', {
                                    dryRun: false,
                                    reason: decisionReason,
                                });
                                return;
                            }
                        }
                        reworkCycles += 1;
                    } while (verdictRef.v === 'rework' && reworkCycles < this.maxReworkCycles);
                    if (verdictRef.v === 'block') {
                        yield this.settleConcept(lc, 'failed', {
                            dryRun: false,
                            reason: 'critique blocked execution',
                        });
                        return;
                    }
                }
                if (yield this.checkAbort(lc))
                    return;
                yield this.settleConcept(lc, 'done', { dryRun: input.dryRun === true });
            }
            catch (err) {
                const reason = formatError(err);
                yield this.settleConcept(lc, 'failed', {
                    dryRun: input.dryRun === true,
                    reason,
                    rejectWith: err,
                });
            }
        });
    }
    // ─── Phase runner ─────────────────────────────────────────────────────────
    /**
     * Wraps a phase callback with DAG lease/start/complete lifecycle.
     * If the node is already `succeeded` in the persisted DAG, the callback is
     * skipped and undefined is returned (resume-from-node / rehydration).
     */
    runPhase(lc, nodeKind, callback, nodeId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const id = nodeId !== null && nodeId !== void 0 ? nodeId : nodeKind;
            const existing = lc.dag.getNode(id);
            // Skip already-succeeded nodes (DAG rehydration / resume-from-node)
            if ((existing === null || existing === void 0 ? void 0 : existing.status) === 'succeeded') {
                const artifacts = yield this.artifactRefsForNode(existing);
                if (artifacts.length > 0) {
                    for (const ref of artifacts)
                        this.recordPhaseArtifact(lc, existing.id, ref);
                    lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, artifacts);
                    if (existing.kind === NODE_KIND.plan)
                        lc.record.planRef = (_a = artifacts.find(ref => ref.kind === 'plan')) !== null && _a !== void 0 ? _a : lc.record.planRef;
                    if (existing.kind === NODE_KIND.critique)
                        lc.record.critiqueRef = (_b = artifacts.at(-1)) !== null && _b !== void 0 ? _b : lc.record.critiqueRef;
                    if (existing.kind === NODE_KIND.postmortem)
                        lc.record.postmortemRef = (_c = artifacts.find(ref => ref.kind === 'postmortem_report')) !== null && _c !== void 0 ? _c : lc.record.postmortemRef;
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
            lc.dag.leaseNode(node.id, 'engine-loop', 60000);
            lc.dag.startNode(node.id, 'engine-loop');
            try {
                const result = yield callback(node);
                lc.dag.completeNode(node.id, this.buildProvenance(lc, node.id));
                return result;
            }
            catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                lc.dag.failNode(node.id, reason, true);
                throw err;
            }
        });
    }
    // ─── Abort handling ───────────────────────────────────────────────────────
    /**
     * Returns true if an abort has been signalled and emits the abort events.
     */
    checkAbort(lc) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!lc.aborted)
                return false;
            const { conceptId, runId } = lc.record;
            const reason = (_a = lc.abortReason) !== null && _a !== void 0 ? _a : 'aborted';
            lc.record.status = 'aborted';
            lc.record.completedAt = new Date().toISOString();
            yield this.deps.ledger.append({ type: 'concept.completed', run_id: runId, concept_id: conceptId, status: 'aborted', reason });
            yield this.deps.ledger.append({ type: 'run.cancelled', run_id: runId, reason });
            yield lc.dag.flushLedger();
            lc.resolve(snapshot(lc.record));
            return true;
        });
    }
    // ─── Helpers ──────────────────────────────────────────────────────────────
    emitPhaseStarted(lc, phase) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.emitLedger(lc, {
                type: 'dag.node.started',
                run_id: lc.record.runId,
                dag_id: lc.record.conceptId,
                node_id: phase,
            });
        });
    }
    emitPhaseCompleted(lc, phase, artifactId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.emitLedger(lc, Object.assign({ type: 'dag.node.completed', run_id: lc.record.runId, dag_id: lc.record.conceptId, node_id: phase }, (artifactId !== undefined ? { artifact_refs: [artifactId] } : {})));
        });
    }
    emitLedger(lc, event) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.deps.ledger.append(event);
        });
    }
    createRunStruggleDetector() {
        if (this.deps.struggleDetectorFactory)
            return this.deps.struggleDetectorFactory();
        const boundedWindow = Math.max(2, Math.min(3, this.maxReworkCycles));
        return createStruggleDetector({
            flatWindow: boundedWindow,
            minIterations: boundedWindow,
        });
    }
    emitStruggleDetected(lc, nodeId, signal, loopCount, verdict, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.emitLedger(lc, Object.assign({ type: 'struggle.detected', run_id: lc.record.runId, concept_id: lc.record.conceptId, node_id: nodeId, signal_kind: signal.kind, loop_count: loopCount, verdict,
                reason }, struggleSignalFields(signal)));
        });
    }
    emitSupervisorDecision(lc, nodeId, action, trigger, reason, loopCount) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const phase = (_a = lc.record.currentPhase) !== null && _a !== void 0 ? _a : 'execute';
            const decisionVector = this.buildSupervisorDecisionVector(phase, loopCount);
            const decisionArtifacts = yield this.persistSupervisorDecisionArtifacts(lc, nodeId, action, trigger, reason, loopCount, decisionVector);
            yield this.emitLedger(lc, {
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
        });
    }
    buildSupervisorDecisionVector(phase, loopCount) {
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
    persistSupervisorDecisionArtifacts(lc, nodeId, action, trigger, reason, loopCount, decisionVector) {
        return __awaiter(this, void 0, void 0, function* () {
            const decisionVectorRef = yield this.deps.artifactStore.writeJSON('decision_vector', decisionVector, {
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
            const decisionRecord = this.buildSupervisorDecisionRecord(lc, nodeId, action, reason, loopCount, evidenceRefs, decisionVectorRef.id);
            const auditRecord = toAuditDecisionRecord(decisionRecord, loopCount);
            const assessment = assessDecisionRecord({ record: auditRecord });
            const decisionRecordRef = yield this.deps.artifactStore.writeJSON('decision_record', decisionRecord, {
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
            const decisionAuditRef = yield this.deps.artifactStore.writeJSON('decision_record_audit', {
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
            yield this.emitLedger(lc, {
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
        });
    }
    buildSupervisorDecisionRecord(lc, nodeId, action, reason, loopCount, evidenceRefs, decisionVectorRef) {
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
    prepareExecutionPlan(lc, plan) {
        return __awaiter(this, void 0, void 0, function* () {
            const executionContext = renderExecutionContext(plan);
            const rotation = this.contextRotator.shouldRotate(executionContext);
            if (!rotation.rotate)
                return plan;
            const rotated = yield this.contextRotator.rotate(executionContext);
            const summary = rotated.summary.trim() || plan.rationale;
            yield this.emitSupervisorDecision(lc, NODE_KIND.execute, 'rotate_context', 'context_pressure', rotation.reason, 0);
            yield this.emitLedger(lc, {
                type: 'context.rotated',
                run_id: lc.record.runId,
                concept_id: lc.record.conceptId,
                node_id: NODE_KIND.execute,
                reason: rotation.reason,
                tokens_estimated: rotation.tokensEstimated,
                summary_tokens_estimated: this.contextRotator.estimate(summary),
                preserved_artifact_refs: lc.record.artifactRefs.map((ref) => ref.id),
            });
            return Object.assign(Object.assign({}, plan), { rationale: summary });
        });
    }
    recordRunFailed(lc, runId, originalReason) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.emitLedger(lc, { type: 'run.failed', run_id: runId, error: originalReason });
            }
            catch (err) {
                lc.record.error = `${originalReason}; failed to append run.failed: ${formatError(err)}`;
            }
        });
    }
    settleConcept(lc, status, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const { conceptId, runId } = lc.record;
            const terminalPhase = lc.record.currentPhase;
            const learningErrors = opts.dryRun
                ? []
                : yield this.runTerminalLearningLoop(lc, status === 'done' ? 'completed' : 'failed', terminalPhase, opts.reason);
            lc.record.phases = addPhase(lc.record.phases, 'done');
            lc.record.currentPhase = 'done';
            lc.record.status = status;
            if (status === 'failed') {
                lc.record.error = combineMessages(opts.reason, learningErrors);
            }
            else if (learningErrors.length > 0) {
                lc.record.error = combineMessages(lc.record.error, learningErrors);
            }
            lc.record.completedAt = new Date().toISOString();
            yield this.emitLedger(lc, { type: 'concept.completed', run_id: runId, concept_id: conceptId, status });
            if (status === 'done') {
                yield this.emitLedger(lc, { type: 'run.completed', run_id: runId, status: 'done' });
            }
            else {
                yield this.recordRunFailed(lc, runId, (_b = (_a = lc.record.error) !== null && _a !== void 0 ? _a : opts.reason) !== null && _b !== void 0 ? _b : 'unknown failure');
            }
            try {
                yield lc.dag.flushLedger();
            }
            catch (flushErr) {
                lc.record.error = combineMessages(lc.record.error, [`failed to flush DAG ledger: ${formatError(flushErr)}`]);
            }
            if (opts.rejectWith !== undefined) {
                lc.reject(opts.rejectWith);
                return;
            }
            lc.resolve(snapshot(lc.record));
        });
    }
    runTerminalLearningLoop(lc, outcome, terminalPhase, terminalReason) {
        return __awaiter(this, void 0, void 0, function* () {
            const errors = [];
            let postmortemRef;
            try {
                postmortemRef = yield this.runPostmortemPhase(lc, outcome, terminalPhase, terminalReason);
            }
            catch (err) {
                errors.push(`postmortem failed: ${formatError(err)}`);
            }
            if (!postmortemRef)
                return errors;
            try {
                yield this.runMemoryPersistPhase(lc, postmortemRef, outcome, terminalReason);
            }
            catch (err) {
                errors.push(`memory persist failed: ${formatError(err)}`);
            }
            return errors;
        });
    }
    runPostmortemPhase(lc, outcome, terminalPhase, terminalReason) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const result = yield this.runPhase(lc, NODE_KIND.postmortem, (node) => __awaiter(this, void 0, void 0, function* () {
                lc.record.status = 'postmortem';
                lc.record.currentPhase = 'postmortem';
                lc.record.phases = addPhase(lc.record.phases, 'postmortem');
                yield this.emitPhaseStarted(lc, 'postmortem');
                const postmortemRef = yield runPostMortem(yield this.buildPostMortemInput(lc, outcome, terminalPhase, terminalReason), {
                    artifactStore: this.deps.artifactStore,
                    ledger: this.deps.ledger,
                    clock: this.deps.clock,
                });
                lc.record.postmortemRef = postmortemRef;
                lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, [postmortemRef]);
                this.recordPhaseArtifact(lc, node.id, postmortemRef);
                yield this.emitPhaseCompleted(lc, 'postmortem', postmortemRef.id);
                return { postmortemRef };
            }));
            const restored = (_b = (_a = result === null || result === void 0 ? void 0 : result.postmortemRef) !== null && _a !== void 0 ? _a : lc.record.postmortemRef) !== null && _b !== void 0 ? _b : yield this.findArtifactRefForSucceededNode(lc, NODE_KIND.postmortem, 'postmortem_report');
            if (restored) {
                lc.record.postmortemRef = restored;
                lc.record.artifactRefs = mergeArtifactRefs(lc.record.artifactRefs, [restored]);
                this.recordPhaseArtifact(lc, NODE_KIND.postmortem, restored);
            }
            return restored;
        });
    }
    runMemoryPersistPhase(lc, postmortemRef, outcome, terminalReason) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.runPhase(lc, NODE_KIND.memoryPersist, () => __awaiter(this, void 0, void 0, function* () {
                lc.record.status = 'persisting_memory';
                lc.record.currentPhase = 'memory_persist';
                lc.record.phases = addPhase(lc.record.phases, 'memory_persist');
                yield this.emitPhaseStarted(lc, 'memory_persist');
                const artifactRefs = uniqueStrings([postmortemRef.id, ...lc.record.artifactRefs.map((ref) => ref.id)]);
                const input = yield this.buildHistorianDistillInput(lc, postmortemRef, artifactRefs, outcome, terminalReason);
                yield persistLessons(input, {
                    runId: lc.record.runId,
                    conceptId: lc.record.conceptId,
                    projectId: lc.record.projectId,
                    parentConceptId: lc.record.parentConceptId,
                    retryOf: lc.record.retryOf,
                    nodeId: NODE_KIND.memoryPersist,
                    artifactRefs,
                    algorithm: 'lessons_learned',
                }, {
                    memoryStore: this.deps.memoryStore,
                    approvalFlow: this.deps.approvalFlow,
                    ledger: this.deps.ledger,
                });
                yield this.emitPhaseCompleted(lc, 'memory_persist');
                return { persisted: true };
            }));
        });
    }
    buildPostMortemInput(lc, outcome, terminalPhase, terminalReason) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const critiqueReports = yield this.collectLoadedCritiqueReports(lc);
            const passFindings = critiqueReports.flatMap((report) => report.results.filter((result) => result.verdict === 'pass').map((result) => result.rationale.trim())).filter(Boolean);
            const failFindings = critiqueReports.flatMap((report) => report.results.filter((result) => result.verdict !== 'pass').map((result) => result.rationale.trim())).filter(Boolean);
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
                    ? [`terminal failure in ${terminalPhase !== null && terminalPhase !== void 0 ? terminalPhase : 'unknown'} phase`]
                    : []),
            ]);
            return {
                conceptRecord: lc.record,
                outcome,
                summary: outcome === 'completed'
                    ? `Concept completed after ${lc.record.phases.filter((phase) => phase !== 'done').join(' → ')}.`
                    : `Concept failed during ${terminalPhase !== null && terminalPhase !== void 0 ? terminalPhase : 'unknown'}: ${(_a = terminalReason !== null && terminalReason !== void 0 ? terminalReason : lc.record.error) !== null && _a !== void 0 ? _a : 'unknown failure'}.`,
                whatWorked,
                whatFailed,
                verifierFindings: uniqueStrings([...passFindings, ...failFindings]),
            };
        });
    }
    buildHistorianDistillInput(lc, postmortemRef, artifactRefs, outcome, terminalReason) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const postmortem = yield this.readArtifactJson(postmortemRef);
            const critiqueReports = yield this.collectLoadedCritiqueReports(lc);
            const lessons = {
                scope: 'run',
                whatWorked: postmortem.whatWorked.length > 0 ? postmortem.whatWorked : ['governed execution completed'],
                whatFailed: postmortem.whatFailed.length > 0 ? postmortem.whatFailed : outcome === 'failed'
                    ? [(_a = terminalReason !== null && terminalReason !== void 0 ? terminalReason : lc.record.error) !== null && _a !== void 0 ? _a : 'terminal failure']
                    : [],
                rootCause: inferLessonRootCause(critiqueReports, terminalReason !== null && terminalReason !== void 0 ? terminalReason : lc.record.error),
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
                    nodeHash: (_b = postmortemRef.sha256) !== null && _b !== void 0 ? _b : postmortemRef.id,
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
        });
    }
    collectLoadedCritiqueReports(lc) {
        return __awaiter(this, void 0, void 0, function* () {
            const critiqueRefs = [...lc.phaseArtifacts.entries()]
                .filter(([nodeId]) => nodeId.startsWith(NODE_KIND.critique))
                .flatMap(([, refs]) => refs);
            const reports = yield Promise.all(critiqueRefs.map((ref) => this.tryReadCritiqueReport(ref)));
            return reports.filter((report) => report !== undefined);
        });
    }
    tryReadCritiqueReport(ref) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return ref.sha256
                    ? this.deps.artifactStore.readJSONVerified(ref, ref.sha256)
                    : this.deps.artifactStore.readJSON(ref);
            }
            catch (_a) {
                return undefined;
            }
        });
    }
    readArtifactJson(ref) {
        return __awaiter(this, void 0, void 0, function* () {
            return ref.sha256
                ? this.deps.artifactStore.readJSONVerified(ref, ref.sha256)
                : this.deps.artifactStore.readJSON(ref);
        });
    }
    buildProvenance(lc, nodeId) {
        var _a;
        const refs = (_a = lc.phaseArtifacts.get(nodeId)) !== null && _a !== void 0 ? _a : [];
        return refs.map((ref) => ({
            kind: 'artifact',
            ref: ref.id,
            role: 'output',
            sha256: ref.sha256,
        }));
    }
    recordPhaseArtifact(lc, nodeKind, ref) {
        var _a;
        const existing = (_a = lc.phaseArtifacts.get(nodeKind)) !== null && _a !== void 0 ? _a : [];
        if (existing.some(item => item.id === ref.id))
            return;
        lc.phaseArtifacts.set(nodeKind, [...existing, ref]);
    }
    restorePlanResult(lc) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const planRef = (_a = lc.record.planRef) !== null && _a !== void 0 ? _a : yield this.findArtifactRefForSucceededNode(lc, NODE_KIND.plan, 'plan');
            if (!planRef)
                return undefined;
            const plan = planRef.sha256
                ? yield this.deps.artifactStore.readJSONVerified(planRef, planRef.sha256)
                : yield this.deps.artifactStore.readJSON(planRef);
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
        });
    }
    findArtifactRefForSucceededNode(lc, nodeKind, artifactKind) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const nodes = lc.dag.listNodes({ status: 'succeeded', kind: nodeKind });
            const artifactId = (_a = nodes
                .flatMap(node => node.provenance)
                .find(link => link.kind === 'artifact')) === null || _a === void 0 ? void 0 : _a.ref;
            if (!artifactId)
                return undefined;
            return this.findArtifactRef(artifactId, artifactKind);
        });
    }
    artifactRefsForNode(node) {
        return __awaiter(this, void 0, void 0, function* () {
            const refs = [];
            for (const link of node.provenance.filter(link => link.kind === 'artifact')) {
                const ref = yield this.findArtifactRef(link.ref);
                if (!ref)
                    throw new Error(`UniversalEngineOrchestrator: missing artifact "${link.ref}" for succeeded DAG node "${node.id}"`);
                refs.push(ref);
            }
            return refs;
        });
    }
    findArtifactRef(artifactId, artifactKind) {
        return __awaiter(this, void 0, void 0, function* () {
            const refs = yield this.deps.artifactStore.list(artifactKind ? { kind: artifactKind } : undefined);
            return refs.find(ref => ref.id === artifactId);
        });
    }
}
// ─── Standalone API (wired into runtime/index.ts) ────────────────────────────
/**
 * Factory that creates a `UniversalEngineOrchestrator`.
 * Wire this in `PyrforRuntime.startUniversalEngine()`.
 */
export function startUniversalEngine(deps) {
    return new UniversalEngineOrchestrator(deps);
}
/**
 * Convenience wrapper: create and immediately dispatch a concept.
 * Equivalent to `startUniversalEngine(deps).dispatchConcept(input)`.
 */
export function dispatchConcept(orchestrator, input) {
    return orchestrator.dispatchConcept(input);
}
// ─── Internal helpers ─────────────────────────────────────────────────────────
function makeHandle(conceptId, lc) {
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
function isTerminal(status) {
    return status === 'done' || status === 'aborted' || status === 'failed';
}
function addPhase(phases, phase) {
    if (phases.includes(phase))
        return phases;
    return [...phases, phase];
}
function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
}
function snapshot(record) {
    return Object.assign(Object.assign({}, record), { artifactRefs: [...record.artifactRefs], phases: [...record.phases] });
}
function renderExecutionContext(plan) {
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
function scoreCritiqueVerdict(verdict) {
    switch (verdict) {
        case 'pass':
            return 100;
        case 'rework':
            return 60;
        case 'block':
            return 0;
    }
}
function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const normalized = value.trim();
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}
function verifierScore(reports) {
    const verdicts = reports.flatMap((report) => report.results.map((result) => result.verdict));
    if (verdicts.length === 0)
        return undefined;
    const total = verdicts.reduce((sum, verdict) => sum + scoreCritiqueVerdict(verdict), 0);
    return Number((total / (verdicts.length * 100)).toFixed(3));
}
function acceptanceTestPassRate(reports) {
    const verdicts = reports.flatMap((report) => report.results.map((result) => result.verdict));
    if (verdicts.length === 0)
        return undefined;
    const passed = verdicts.filter((verdict) => verdict === 'pass').length;
    return Number((passed / verdicts.length).toFixed(3));
}
function inferLessonDomain(goal) {
    const text = goal.toLowerCase();
    if (/test|typescript|javascript|code|bug|build|lint|api|cli|runtime|engine/.test(text))
        return 'coding';
    if (/deploy|release|ci|workflow|docker|server|cloud|infra/.test(text))
        return 'infra';
    if (/research|analy[sz]e|исслед|анализ/.test(text))
        return 'research';
    if (/operator|migration|ops|runbook|incident/.test(text))
        return 'ops';
    return 'general';
}
function combineMessages(primary, extra) {
    const parts = uniqueStrings([primary !== null && primary !== void 0 ? primary : '', ...extra]);
    return parts.length > 0 ? parts.join('; ') : undefined;
}
function inferLessonRootCause(reports, terminalReason) {
    if (reports.some((report) => new Set(report.results.map((result) => result.verdict)).size > 1)) {
        return 'verifier_disagreement';
    }
    const corpus = [terminalReason !== null && terminalReason !== void 0 ? terminalReason : '', ...reports.flatMap((report) => report.results.map((result) => result.rationale))].join('\n').toLowerCase();
    if (/budget|tier|approval/.test(corpus))
        return 'budget_or_tier';
    if (/external|dependency|timeout|network/.test(corpus))
        return 'external_dependency';
    if (/tool|missing capability/.test(corpus))
        return 'tool_gap';
    if (/spec|requirement|clarif/.test(corpus))
        return 'spec_gap';
    if (/test|acceptance|verify|verifier/.test(corpus))
        return 'test_gap';
    return 'execution_bug';
}
function alternativesForSupervisorAction(action) {
    switch (action) {
        case 'rotate_context':
            return ['continue', 'rotate_context'];
        case 'abort':
            return ['continue', 'abort'];
        case 'continue':
            return ['continue'];
    }
}
function toAuditDecisionRecord(record, loopCount) {
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
function decisionAuditDisposition(assessment) {
    if (assessment.safetyBlock)
        return 'safety_block';
    if (assessment.block)
        return 'gate_failed';
    if (assessment.quarantined)
        return 'quarantined';
    return 'accepted';
}
function hashSupervisorNode(conceptId, nodeId, action, reason, loopCount) {
    return createHash('sha256')
        .update(JSON.stringify({ conceptId, nodeId, action, reason, loopCount }))
        .digest('hex');
}
function describeStruggleSignal(signal) {
    switch (signal.kind) {
        case 'flat':
            return `flat progress for ${signal.iterations} iterations`;
        case 'regression':
            return `regression from ${signal.from} to ${signal.to}`;
        case 'oscillation':
            return `oscillation over ${signal.window} scores`;
    }
}
function struggleSignalFields(signal) {
    switch (signal.kind) {
        case 'flat':
            return { iterations: signal.iterations, last_score: signal.lastScore };
        case 'regression':
            return { from_score: signal.from, to_score: signal.to };
        case 'oscillation':
            return { window: signal.window };
    }
}
function mergeArtifactRefs(existing, incoming) {
    const seen = new Set(existing.map(ref => ref.id));
    const merged = [...existing];
    for (const ref of incoming) {
        if (seen.has(ref.id))
            continue;
        seen.add(ref.id);
        merged.push(ref);
    }
    return merged;
}
function formatError(err) {
    return err instanceof Error ? err.message : String(err);
}
function makeId() {
    return randomUUID().replace(/-/g, '').slice(0, 20);
}

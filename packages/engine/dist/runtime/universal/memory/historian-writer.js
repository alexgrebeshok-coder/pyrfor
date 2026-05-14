var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from 'node:crypto';
import { distillLessons } from '../historian.js';
import { createStrategyStore } from './strategy-store.js';
export function persistLessons(input, provenance, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        validateProvenance(provenance);
        const distilled = distillLessons(input);
        const conflictRequests = [];
        const result = { conflictRequests };
        if (distilled.singleLoop) {
            result.singleLoopEntry = yield writeLessonRecord(distilled.singleLoop, provenance, deps);
        }
        if (distilled.doubleLoop) {
            result.doubleLoopEntry = yield writeLessonRecord(distilled.doubleLoop, provenance, deps);
        }
        return result;
    });
}
export function promoteDoubleLoop(entryId, approvedBy, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!approvedBy.trim())
            throw new HistorianWriterError('approvedBy is required');
        const entry = deps.memoryStore.get(entryId);
        if (!entry)
            return null;
        const record = assertDoubleLoopTransition(entry, 'approved');
        const updated = deps.memoryStore.update(entryId, {
            tags: transitionTags(entry.tags, 'approved'),
            text: JSON.stringify(Object.assign(Object.assign({}, record), { status: 'approved' })),
        });
        if (updated) {
            yield deps.ledger.append({
                type: 'memory.written',
                run_id: (_a = tagValue(updated.tags, 'runId:')) !== null && _a !== void 0 ? _a : 'memory',
                concept_id: tagValue(updated.tags, 'conceptId:'),
                node_id: tagValue(updated.tags, 'nodeId:'),
                entry_id: updated.id,
                memory_kind: updated.kind,
                memory_scope: updated.scope,
                artifact_refs: artifactTags(updated.tags),
                reason: `double_loop_promoted_by:${approvedBy}`,
            });
        }
        return updated;
    });
}
export function quarantineDoubleLoop(entryId, reason, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!reason.trim())
            throw new HistorianWriterError('reason is required');
        const entry = deps.memoryStore.get(entryId);
        if (!entry)
            return null;
        const record = assertDoubleLoopTransition(entry, 'quarantined');
        const updated = deps.memoryStore.update(entryId, {
            tags: transitionTags(entry.tags, 'quarantined'),
            text: JSON.stringify(Object.assign(Object.assign({}, record), { status: 'quarantined', rejectionReason: reason })),
        });
        if (updated) {
            yield deps.ledger.append({
                type: 'memory.written',
                run_id: (_a = tagValue(updated.tags, 'runId:')) !== null && _a !== void 0 ? _a : 'memory',
                concept_id: tagValue(updated.tags, 'conceptId:'),
                node_id: tagValue(updated.tags, 'nodeId:'),
                entry_id: updated.id,
                memory_kind: updated.kind,
                memory_scope: updated.scope,
                artifact_refs: artifactTags(updated.tags),
                reason: `double_loop_quarantined:${reason}`,
            });
        }
        return updated;
    });
}
export function writeStrategyOrConflict(input, provenance, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        validateProvenance(provenance);
        const strategyStore = (_a = deps.strategyStore) !== null && _a !== void 0 ? _a : createStrategyStore(deps.memoryStore);
        const existing = strategyStore.getApproved(input.key, { projectId: input.projectId, includeGlobal: true });
        if (existing && existing.value !== input.value) {
            const approvalId = randomUUID();
            const decision = yield deps.approvalFlow.requestApproval({
                id: approvalId,
                toolName: 'memory.write',
                summary: `Strategy memory conflict on key "${input.key}"`,
                args: {
                    key: input.key,
                    existing: existing.value,
                    proposed: input.value,
                },
                run_id: provenance.runId,
                concept_id: provenance.conceptId,
                engine_phase: 'memory_persist',
                reason_codes: ['conflict'],
            });
            yield deps.ledger.append({
                type: 'memory.conflict',
                run_id: provenance.runId,
                concept_id: provenance.conceptId,
                node_id: provenance.nodeId,
                conflict_key: input.key,
                existing_entry_id: existing.memoryEntryId,
                approval_id: approvalId,
                decision,
                artifact_refs: provenance.artifactRefs,
            });
            if (decision !== 'approve')
                return { conflictId: approvalId };
        }
        const strategy = strategyStore.setApproved(input);
        const entry = deps.memoryStore.get(strategy.memoryEntryId);
        if (!entry)
            throw new HistorianWriterError(`strategy entry disappeared: ${strategy.memoryEntryId}`);
        const tagged = deps.memoryStore.update(entry.id, {
            tags: mergeTags(entry.tags, provenanceTags(provenance)),
        });
        if (!tagged)
            throw new HistorianWriterError(`strategy entry disappeared during provenance tagging: ${entry.id}`);
        yield deps.ledger.append({
            type: 'memory.written',
            run_id: provenance.runId,
            concept_id: provenance.conceptId,
            node_id: provenance.nodeId,
            entry_id: tagged.id,
            memory_kind: tagged.kind,
            memory_scope: tagged.scope,
            artifact_refs: provenance.artifactRefs,
            reason: 'strategy_memory_write',
        });
        return { wrote: tagged };
    });
}
export class HistorianWriterError extends Error {
    constructor(message) {
        super(message);
        this.name = 'HistorianWriterError';
    }
}
function writeLessonRecord(record, provenance, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        const entry = deps.memoryStore.add({
            kind: 'lesson',
            text: JSON.stringify(record),
            source: `historian:${provenance.runId}`,
            scope: 'universal',
            tags: lessonTags(record, provenance),
            weight: record.confidence === 'high' ? 0.9 : record.confidence === 'medium' ? 0.6 : 0.3,
        });
        yield deps.ledger.append({
            type: 'memory.written',
            run_id: provenance.runId,
            concept_id: provenance.conceptId,
            node_id: provenance.nodeId,
            entry_id: entry.id,
            memory_kind: entry.kind,
            memory_scope: entry.scope,
            artifact_refs: provenance.artifactRefs,
            reason: `${record.kind}_lesson_write`,
        });
        return entry;
    });
}
function validateProvenance(provenance) {
    if (!provenance.runId.trim())
        throw new HistorianWriterError('runId is required');
    if (!provenance.nodeId.trim())
        throw new HistorianWriterError('nodeId is required');
    if (provenance.artifactRefs.length === 0)
        throw new HistorianWriterError('at least one artifactRef is required');
}
function lessonTags(record, provenance) {
    return [
        record.kind,
        `confidence:${record.confidence}`,
        record.provenance,
        ...provenanceTags(provenance),
        record.context.phase,
        record.context.nodeKind,
        ...(record.kind === 'single_loop' && record.eligibleForStrategyDistillation ? ['approved'] : []),
        ...(record.kind === 'double_loop' ? [record.status] : []),
        ...(record.kind === 'double_loop' ? [record.targetScope.ruleKey] : []),
    ];
}
function provenanceTags(provenance) {
    return [
        provenance.algorithm,
        `runId:${provenance.runId}`,
        `nodeId:${provenance.nodeId}`,
        ...(provenance.conceptId ? [`conceptId:${provenance.conceptId}`] : []),
        ...provenance.artifactRefs.map((ref) => `artifactRef:${ref}`),
    ];
}
function transitionTags(tags, status) {
    const statusTags = new Set(['candidate', 'pending_approval', 'approved', 'rejected', 'quarantined', 'superseded']);
    return [...tags.filter((tag) => !statusTags.has(tag)), status];
}
function assertDoubleLoopTransition(entry, nextStatus) {
    if (entry.kind !== 'lesson' || !entry.tags.includes('double_loop')) {
        throw new HistorianWriterError(`cannot ${nextStatus} non-double-loop memory entry: ${entry.id}`);
    }
    if (!entry.tags.includes('candidate') && !entry.tags.includes('pending_approval')) {
        throw new HistorianWriterError(`cannot ${nextStatus} double-loop entry without candidate/pending_approval state: ${entry.id}`);
    }
    const record = parseDoubleLoopRecord(entry);
    const tagStatus = entry.tags.includes('candidate') ? 'candidate' : 'pending_approval';
    if (record.status !== tagStatus) {
        throw new HistorianWriterError(`double-loop record status does not match tags for entry: ${entry.id}`);
    }
    return record;
}
function parseDoubleLoopRecord(entry) {
    const parsed = JSON.parse(entry.text);
    if (parsed.kind !== 'double_loop' ||
        typeof parsed.id !== 'string' ||
        !isLessonProvenance(parsed.provenance) ||
        !isConfidence(parsed.confidence) ||
        typeof parsed.context !== 'object' ||
        parsed.context === null ||
        typeof parsed.sourceLessonsArtifactRef !== 'string' ||
        !Array.isArray(parsed.evidence) ||
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.author !== 'string' ||
        !isProposedChangeType(parsed.proposedChangeType) ||
        typeof parsed.targetScope !== 'object' ||
        parsed.targetScope === null ||
        typeof parsed.targetScope.ruleKey !== 'string' ||
        typeof parsed.targetScope.currentRule !== 'string' ||
        typeof parsed.targetScope.proposedRule !== 'string' ||
        typeof parsed.systemicDefect !== 'string' ||
        typeof parsed.expectedImpact !== 'string' ||
        typeof parsed.impact !== 'object' ||
        parsed.impact === null ||
        !isImpactVector(parsed.impact) ||
        !Array.isArray(parsed.risks) ||
        typeof parsed.rollbackPlan !== 'string' ||
        typeof parsed.status !== 'string' ||
        typeof parsed.similarityKey !== 'string' ||
        typeof parsed.requiresNovelEvidenceAfterRejection !== 'boolean' ||
        !isLessonContext(parsed.context) ||
        !parsed.evidence.every(isLessonEvidenceRef) ||
        !parsed.risks.every((risk) => typeof risk === 'string') ||
        !isDoubleLoopStatus(parsed.status)) {
        throw new HistorianWriterError(`memory entry does not contain a double-loop record: ${entry.id}`);
    }
    return parsed;
}
function isLessonContext(value) {
    const context = value;
    return typeof context.runId === 'string' &&
        typeof context.nodeId === 'string' &&
        typeof context.nodeHash === 'string' &&
        typeof context.algorithm === 'string' &&
        typeof context.phase === 'string' &&
        typeof context.nodeKind === 'string';
}
function isLessonEvidenceRef(value) {
    const evidence = value;
    return typeof evidence === 'object' &&
        evidence !== null &&
        typeof evidence.artifactRef === 'string' &&
        typeof evidence.verifierConfirmed === 'boolean';
}
function isDoubleLoopStatus(value) {
    return value === 'candidate' ||
        value === 'pending_approval' ||
        value === 'approved' ||
        value === 'rejected' ||
        value === 'quarantined' ||
        value === 'superseded';
}
function isLessonProvenance(value) {
    return value === 'native' || value === 'legacy' || value === 'imported';
}
function isConfidence(value) {
    return value === 'low' || value === 'medium' || value === 'high';
}
function isProposedChangeType(value) {
    return value === 'algorithm' ||
        value === 'heuristic' ||
        value === 'policy' ||
        value === 'budget' ||
        value === 'verifier_rules';
}
function isImpactVector(value) {
    const numericKeys = [
        'predictedScore',
        'observedScore',
        'costDeltaUsd',
        'latencyDeltaMs',
        'successRateDelta',
        'verifierPassRateDelta',
    ];
    const hasNumericSignal = numericKeys.some((key) => value[key] !== undefined && typeof value[key] === 'number' && Number.isFinite(value[key]));
    const hasRiskSignal = value.riskDelta === 'lower' || value.riskDelta === 'same' || value.riskDelta === 'higher';
    return hasNumericSignal || hasRiskSignal;
}
function mergeTags(tags, extra) {
    return [...new Set([...tags, ...extra])];
}
function tagValue(tags, prefix) {
    var _a;
    return (_a = tags.find((tag) => tag.startsWith(prefix))) === null || _a === void 0 ? void 0 : _a.slice(prefix.length);
}
function artifactTags(tags) {
    return tags
        .filter((tag) => tag.startsWith('artifactRef:'))
        .map((tag) => tag.slice('artifactRef:'.length));
}

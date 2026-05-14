import { createHash } from 'node:crypto';
const SIGNAL_WEIGHTS = {
    duplicate_evidence_set: 0.18,
    near_duplicate_rationale: 0.16,
    low_rationale_entropy: 0.12,
    conflicting_same_node_hash: 1,
    budget_inflation_without_new_evidence: 0.2,
    out_of_sequence_write: 0.24,
    excessive_records_without_progress: 0.18,
};
export function assessDecisionRecord(input) {
    var _a, _b, _c;
    const peers = (_a = input.peerRecords) !== null && _a !== void 0 ? _a : [];
    const sameAttempt = peers.filter((peer) => peer.nodeId === input.record.nodeId &&
        peer.attempt === input.record.attempt &&
        peer.id !== input.record.id);
    const canonical = findCanonicalRecord([input.record, ...sameAttempt]);
    const signals = [];
    const evidenceHash = hashEvidenceRefs(input.record.evidenceRefs);
    if (sameAttempt.some((peer) => hashEvidenceRefs(peer.evidenceRefs) === evidenceHash)) {
        signals.push(signal('duplicate_evidence_set', 0.75, 'same evidence set reused for same node attempt'));
    }
    const nearDuplicate = sameAttempt.find((peer) => rationaleSimilarity(peer.rationale, input.record.rationale) >= 0.88);
    if (nearDuplicate) {
        signals.push(signal('near_duplicate_rationale', 0.7, `near duplicate rationale of ${nearDuplicate.id}`));
    }
    const entropy = rationaleEntropy(input.record.rationale);
    if (entropy < 0.32) {
        signals.push(signal('low_rationale_entropy', 0.65, `rationale entropy ${entropy.toFixed(2)}`));
    }
    const conflict = sameAttempt.find((peer) => peer.nodeHash === input.record.nodeHash &&
        peer.selectedAlternative !== input.record.selectedAlternative &&
        isCanonicalCandidate(peer));
    if (conflict && isCanonicalCandidate(input.record)) {
        signals.push(signal('conflicting_same_node_hash', 1, `conflicts with canonical candidate ${conflict.id}`));
    }
    const budgetInflation = sameAttempt.find((peer) => hashEvidenceRefs(peer.evidenceRefs) === evidenceHash &&
        budgetScore(input.record) > budgetScore(peer) * 1.25);
    if (budgetInflation) {
        signals.push(signal('budget_inflation_without_new_evidence', 0.7, `budget increased over ${budgetInflation.id}`));
    }
    if (input.record.nodeStartedAt && input.record.timestamp > input.record.nodeStartedAt && !input.record.supersedesDecisionId) {
        signals.push(signal('out_of_sequence_write', 0.9, 'record was written after node start without supersession'));
    }
    const progressCount = (_c = (_b = input.progressEvents) === null || _b === void 0 ? void 0 : _b.filter((event) => event.nodeId === input.record.nodeId).length) !== null && _c !== void 0 ? _c : 0;
    if (sameAttempt.length >= 4 && progressCount === 0) {
        signals.push(signal('excessive_records_without_progress', 0.8, `${sameAttempt.length + 1} records before progress`));
    }
    const poisonScore = Math.min(1, signals.reduce((sum, item) => sum + item.score * SIGNAL_WEIGHTS[item.code], 0));
    const safetyBlock = signals.some((item) => item.code === 'conflicting_same_node_hash');
    const canonicalRecordId = canonical === null || canonical === void 0 ? void 0 : canonical.id;
    const canonicalValid = canonicalRecordId !== undefined && (canonical === null || canonical === void 0 ? void 0 : canonical.evidenceRefs.length) !== 0;
    const isCanonical = canonicalRecordId === input.record.id;
    return {
        canonical: isCanonical,
        canonicalRecordId,
        quarantined: !isCanonical && poisonScore >= 0.35,
        block: !canonicalValid,
        safetyBlock,
        poisonScore,
        signals,
    };
}
export function hashEvidenceRefs(evidenceRefs) {
    return createHash('sha256').update(JSON.stringify([...evidenceRefs].sort())).digest('hex');
}
function findCanonicalRecord(records) {
    const candidates = records.filter(isCanonicalCandidate);
    if (candidates.length === 0)
        return undefined;
    return candidates.sort((a, b) => {
        const supersessionDelta = Number(Boolean(b.supersedesDecisionId)) - Number(Boolean(a.supersedesDecisionId));
        if (supersessionDelta !== 0)
            return supersessionDelta;
        return a.timestamp.localeCompare(b.timestamp);
    })[0];
}
function isCanonicalCandidate(record) {
    return record.nodeHash.length > 0 && record.evidenceRefs.length > 0 && record.rationale.trim().length > 0;
}
function signal(code, score, details) {
    return { code, score, details };
}
function rationaleSimilarity(a, b) {
    const left = tokenSet(a);
    const right = tokenSet(b);
    if (left.size === 0 && right.size === 0)
        return 1;
    let intersection = 0;
    for (const token of left) {
        if (right.has(token))
            intersection += 1;
    }
    const union = new Set([...left, ...right]).size;
    return union === 0 ? 0 : intersection / union;
}
function rationaleEntropy(value) {
    const tokens = value.toLowerCase().split(/\W+/).filter(Boolean);
    if (tokens.length === 0)
        return 0;
    return new Set(tokens).size / tokens.length;
}
function tokenSet(value) {
    return new Set(value.toLowerCase().split(/\W+/).filter((token) => token.length > 2));
}
function budgetScore(record) {
    var _a, _b, _c;
    const budget = record.budgetImpact;
    if (!budget)
        return 0;
    return (((_a = budget.estimatedTokens) !== null && _a !== void 0 ? _a : 0) / 1000 +
        ((_b = budget.estimatedUsd) !== null && _b !== void 0 ? _b : 0) * 100 +
        ((_c = budget.estimatedWallMs) !== null && _c !== void 0 ? _c : 0) / 1000);
}

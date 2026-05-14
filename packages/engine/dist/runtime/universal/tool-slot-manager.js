var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash } from 'node:crypto';
export class ToolSlotManager {
    constructor(ledger, options = {}) {
        var _a, _b;
        this.ledger = ledger;
        this.softCap = (_a = options.softCap) !== null && _a !== void 0 ? _a : 2;
        this.hardCap = (_b = options.hardCap) !== null && _b !== void 0 ? _b : 3;
        if (!Number.isInteger(this.softCap) || this.softCap < 0) {
            throw new ToolSlotError('softCap must be a non-negative integer');
        }
        if (!Number.isInteger(this.hardCap) || this.hardCap < 1 || this.hardCap < this.softCap) {
            throw new ToolSlotError('hardCap must be an integer >= 1 and >= softCap');
        }
    }
    reserve(request) {
        return __awaiter(this, void 0, void 0, function* () {
            validateSlotRequest(request);
            return this.withLineageLock(request.parentConceptId, () => __awaiter(this, void 0, void 0, function* () {
                const slots = yield this.readLineageSlots(request.parentConceptId);
                const existing = slots.get(request.capabilityFingerprint);
                if (existing) {
                    return {
                        status: 'duplicate',
                        reason: 'capability fingerprint already has an active slot',
                        activeSlotCount: slots.size,
                        event: existing.event,
                    };
                }
                if (slots.size >= this.hardCap) {
                    return {
                        status: 'blocked',
                        reason: 'hard tool slot cap exhausted',
                        activeSlotCount: slots.size,
                    };
                }
                if (slots.size >= this.softCap && !request.approvalId) {
                    return {
                        status: 'blocked',
                        reason: 'soft tool slot cap requires approval',
                        activeSlotCount: slots.size,
                    };
                }
                const event = yield this.appendToolSlotEvent('tool.slot.reserved', request);
                return {
                    status: 'reserved',
                    reason: 'tool slot reserved',
                    activeSlotCount: slots.size + 1,
                    event,
                };
            }));
        });
    }
    commit(request) {
        return __awaiter(this, void 0, void 0, function* () {
            validateSlotRequest(request);
            return this.withLineageLock(request.parentConceptId, () => __awaiter(this, void 0, void 0, function* () {
                const slots = yield this.readLineageSlots(request.parentConceptId);
                const existing = slots.get(request.capabilityFingerprint);
                if (!existing) {
                    return { status: 'missing', reason: 'cannot commit a missing slot' };
                }
                if (existing.status === 'committed') {
                    return { status: 'committed', reason: 'tool slot already committed', event: existing.event };
                }
                const event = yield this.appendToolSlotEvent('tool.slot.committed', request);
                return { status: 'committed', reason: 'tool slot committed', event };
            }));
        });
    }
    release(request) {
        return __awaiter(this, void 0, void 0, function* () {
            validateSlotRequest(request);
            return this.withLineageLock(request.parentConceptId, () => __awaiter(this, void 0, void 0, function* () {
                const slots = yield this.readLineageSlots(request.parentConceptId);
                const existing = slots.get(request.capabilityFingerprint);
                if (!existing) {
                    return { status: 'missing', reason: 'cannot release a missing slot' };
                }
                if (existing.status === 'committed') {
                    return { status: 'blocked', reason: 'committed tool slots cannot be released' };
                }
                const event = yield this.appendToolSlotEvent('tool.slot.released', request);
                return { status: 'released', reason: 'tool slot released', event };
            }));
        });
    }
    activeSlots(parentConceptId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!parentConceptId.trim())
                throw new ToolSlotError('parentConceptId is required');
            return [...(yield this.readLineageSlots(parentConceptId)).values()].map((slot) => slot.event);
        });
    }
    readLineageSlots(parentConceptId) {
        return __awaiter(this, void 0, void 0, function* () {
            const slots = new Map();
            for (const event of yield this.ledger.readAll()) {
                if (!isToolSlotEvent(event) || event.parent_concept_id !== parentConceptId)
                    continue;
                if (event.type === 'tool.slot.released') {
                    slots.delete(event.capability_fingerprint);
                    continue;
                }
                slots.set(event.capability_fingerprint, {
                    status: event.type === 'tool.slot.committed' ? 'committed' : 'reserved',
                    event,
                });
            }
            return slots;
        });
    }
    appendToolSlotEvent(type, request) {
        return __awaiter(this, void 0, void 0, function* () {
            const event = yield this.ledger.append({
                type,
                run_id: request.runId,
                parent_concept_id: request.parentConceptId,
                capability_fingerprint: request.capabilityFingerprint,
                tool_name: request.toolName,
                node_id: request.nodeId,
                approval_id: request.approvalId,
                reason: request.reason,
            });
            return event;
        });
    }
    withLineageLock(parentConceptId, operation) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const lockKey = `${this.ledger.storagePath}\u0000${parentConceptId}`;
            const previous = (_a = ToolSlotManager.processLineageLocks.get(lockKey)) !== null && _a !== void 0 ? _a : Promise.resolve();
            let release;
            const current = new Promise((resolve) => {
                release = resolve;
            });
            const chained = previous.then(() => current, () => current);
            ToolSlotManager.processLineageLocks.set(lockKey, chained);
            yield previous;
            try {
                return yield operation();
            }
            finally {
                release();
                if (ToolSlotManager.processLineageLocks.get(lockKey) === chained) {
                    ToolSlotManager.processLineageLocks.delete(lockKey);
                }
            }
        });
    }
}
ToolSlotManager.processLineageLocks = new Map();
export class ToolSlotError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolSlotError';
    }
}
export function capabilityFingerprint(input) {
    return createHash('sha256').update(canonicalJson(input)).digest('hex');
}
function validateSlotRequest(request) {
    if (!request.runId.trim())
        throw new ToolSlotError('runId is required');
    if (!request.parentConceptId.trim())
        throw new ToolSlotError('parentConceptId is required');
    if (!request.capabilityFingerprint.trim())
        throw new ToolSlotError('capabilityFingerprint is required');
}
function isToolSlotEvent(event) {
    return event.type === 'tool.slot.reserved' || event.type === 'tool.slot.committed' || event.type === 'tool.slot.released';
}
function canonicalJson(value) {
    var _a;
    if (value === null || typeof value !== 'object')
        return (_a = JSON.stringify(value)) !== null && _a !== void 0 ? _a : 'null';
    if (Array.isArray(value))
        return `[${value.map((item) => item === undefined ? 'null' : canonicalJson(item)).join(',')}]`;
    const record = value;
    return `{${Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(',')}}`;
}

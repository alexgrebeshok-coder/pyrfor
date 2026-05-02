/**
 * durable-dag.ts — durable task DAG with leases, idempotency and provenance.
 *
 * This is an orchestration primitive, not a worker queue. It records what can
 * run, who leased it, what artifacts/effects it produced, and how to recover
 * when a lease expires.
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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
function cloneNode(node) {
    return Object.assign(Object.assign({}, node), { payload: Object.assign({}, node.payload), dependsOn: [...node.dependsOn], lease: node.lease ? Object.assign({}, node.lease) : undefined, failure: node.failure ? Object.assign({}, node.failure) : undefined, compensation: Object.assign({}, node.compensation), provenance: node.provenance.map((link) => (Object.assign(Object.assign({}, link), { meta: link.meta ? Object.assign({}, link.meta) : undefined }))) });
}
function isTerminal(status) {
    return TERMINAL_STATUSES.has(status);
}
export class DurableDag {
    constructor(options = {}) {
        var _a, _b, _c, _d;
        this.ledgerWriteChain = Promise.resolve();
        this.nodes = new Map();
        this.storePath = options.storePath;
        this.clock = (_a = options.clock) !== null && _a !== void 0 ? _a : Date.now;
        this.ledger = options.ledger;
        this.ledgerRunId = (_c = (_b = options.ledgerRunId) !== null && _b !== void 0 ? _b : options.dagId) !== null && _c !== void 0 ? _c : 'durable-dag';
        this.dagId = (_d = options.dagId) !== null && _d !== void 0 ? _d : this.ledgerRunId;
        this.load();
    }
    addNode(input) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const idempotencyKey = (_b = (_a = input.idempotencyKey) !== null && _a !== void 0 ? _a : input.id) !== null && _b !== void 0 ? _b : randomUUID();
        const existing = this.findActiveByIdempotencyKey(idempotencyKey);
        if (existing)
            return cloneNode(existing);
        const now = this.clock();
        const node = {
            id: (_c = input.id) !== null && _c !== void 0 ? _c : randomUUID(),
            kind: input.kind,
            payload: (_d = input.payload) !== null && _d !== void 0 ? _d : {},
            status: 'pending',
            dependsOn: (_e = input.dependsOn) !== null && _e !== void 0 ? _e : [],
            idempotencyKey,
            retryClass: (_f = input.retryClass) !== null && _f !== void 0 ? _f : 'transient',
            timeoutClass: (_g = input.timeoutClass) !== null && _g !== void 0 ? _g : 'normal',
            compensation: (_h = input.compensation) !== null && _h !== void 0 ? _h : { kind: 'none' },
            attempts: 0,
            createdAt: now,
            updatedAt: now,
            provenance: (_j = input.provenance) !== null && _j !== void 0 ? _j : [],
        };
        this.nodes.set(node.id, node);
        this.flush();
        this.appendLedger({
            type: 'dag.created',
            run_id: this.ledgerRunId,
            dag_id: this.dagId,
            node_count: this.nodes.size,
        });
        if (this.dependenciesSatisfied(node)) {
            this.appendLedger({
                type: 'dag.node.ready',
                run_id: this.ledgerRunId,
                dag_id: this.dagId,
                node_id: node.id,
                kind: node.kind,
                idempotency_key: node.idempotencyKey,
            });
        }
        return cloneNode(node);
    }
    getNode(id) {
        const node = this.nodes.get(id);
        return node ? cloneNode(node) : undefined;
    }
    hydrateNode(input) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
        const now = this.clock();
        const existing = this.nodes.get(input.id);
        const node = {
            id: input.id,
            kind: input.kind,
            payload: (_b = (_a = input.payload) !== null && _a !== void 0 ? _a : existing === null || existing === void 0 ? void 0 : existing.payload) !== null && _b !== void 0 ? _b : {},
            status: (_d = (_c = input.status) !== null && _c !== void 0 ? _c : existing === null || existing === void 0 ? void 0 : existing.status) !== null && _d !== void 0 ? _d : 'pending',
            dependsOn: (_f = (_e = input.dependsOn) !== null && _e !== void 0 ? _e : existing === null || existing === void 0 ? void 0 : existing.dependsOn) !== null && _f !== void 0 ? _f : [],
            idempotencyKey: (_h = (_g = input.idempotencyKey) !== null && _g !== void 0 ? _g : existing === null || existing === void 0 ? void 0 : existing.idempotencyKey) !== null && _h !== void 0 ? _h : input.id,
            retryClass: (_k = (_j = input.retryClass) !== null && _j !== void 0 ? _j : existing === null || existing === void 0 ? void 0 : existing.retryClass) !== null && _k !== void 0 ? _k : 'transient',
            timeoutClass: (_m = (_l = input.timeoutClass) !== null && _l !== void 0 ? _l : existing === null || existing === void 0 ? void 0 : existing.timeoutClass) !== null && _m !== void 0 ? _m : 'normal',
            compensation: (_p = (_o = input.compensation) !== null && _o !== void 0 ? _o : existing === null || existing === void 0 ? void 0 : existing.compensation) !== null && _p !== void 0 ? _p : { kind: 'none' },
            attempts: (_r = (_q = input.attempts) !== null && _q !== void 0 ? _q : existing === null || existing === void 0 ? void 0 : existing.attempts) !== null && _r !== void 0 ? _r : 0,
            createdAt: (_t = (_s = input.createdAt) !== null && _s !== void 0 ? _s : existing === null || existing === void 0 ? void 0 : existing.createdAt) !== null && _t !== void 0 ? _t : now,
            updatedAt: (_v = (_u = input.updatedAt) !== null && _u !== void 0 ? _u : existing === null || existing === void 0 ? void 0 : existing.updatedAt) !== null && _v !== void 0 ? _v : now,
            lease: (_w = input.lease) !== null && _w !== void 0 ? _w : existing === null || existing === void 0 ? void 0 : existing.lease,
            failure: (_x = input.failure) !== null && _x !== void 0 ? _x : existing === null || existing === void 0 ? void 0 : existing.failure,
            provenance: (_z = (_y = input.provenance) !== null && _y !== void 0 ? _y : existing === null || existing === void 0 ? void 0 : existing.provenance) !== null && _z !== void 0 ? _z : [],
        };
        this.nodes.set(node.id, node);
        this.flush();
        return cloneNode(node);
    }
    listNodes(filter) {
        let nodes = Array.from(this.nodes.values());
        if (filter === null || filter === void 0 ? void 0 : filter.status)
            nodes = nodes.filter((node) => node.status === filter.status);
        if (filter === null || filter === void 0 ? void 0 : filter.kind)
            nodes = nodes.filter((node) => node.kind === filter.kind);
        return nodes.map(cloneNode);
    }
    listReady() {
        return Array.from(this.nodes.values())
            .filter((node) => (node.status === 'pending' || node.status === 'ready') && this.dependenciesSatisfied(node))
            .map(cloneNode);
    }
    leaseNode(nodeId, owner, ttlMs) {
        var _a, _b;
        const node = this.requireNode(nodeId);
        if (!this.dependenciesSatisfied(node)) {
            throw new Error(`DurableDag: dependencies are not satisfied for node "${nodeId}"`);
        }
        if (node.status !== 'pending' && node.status !== 'ready' && !this.isLeaseExpired(node)) {
            throw new Error(`DurableDag: node "${nodeId}" is not leaseable (${node.status})`);
        }
        const now = this.clock();
        const updated = this.updateNode(node, {
            status: 'leased',
            lease: { owner, leasedAt: now, expiresAt: now + ttlMs },
            failure: undefined,
        });
        this.appendLedger({
            type: 'dag.lease.acquired',
            run_id: this.ledgerRunId,
            dag_id: this.dagId,
            node_id: updated.id,
            owner,
            expires_at: (_b = (_a = updated.lease) === null || _a === void 0 ? void 0 : _a.expiresAt) !== null && _b !== void 0 ? _b : now + ttlMs,
        });
        return cloneNode(updated);
    }
    startNode(nodeId, owner) {
        var _a;
        const node = this.requireNode(nodeId);
        if (node.status !== 'leased' || ((_a = node.lease) === null || _a === void 0 ? void 0 : _a.owner) !== owner) {
            throw new Error(`DurableDag: node "${nodeId}" is not leased by "${owner}"`);
        }
        const updated = this.updateNode(node, {
            status: 'running',
            attempts: node.attempts + 1,
        });
        this.appendLedger({
            type: 'dag.node.started',
            run_id: this.ledgerRunId,
            dag_id: this.dagId,
            node_id: updated.id,
            owner,
            attempt: updated.attempts,
        });
        return cloneNode(updated);
    }
    completeNode(nodeId, provenance = []) {
        var _a;
        const node = this.requireNode(nodeId);
        if (node.status !== 'leased' && node.status !== 'running') {
            throw new Error(`DurableDag: node "${nodeId}" cannot complete from ${node.status}`);
        }
        const updated = this.updateNode(node, {
            status: 'succeeded',
            lease: undefined,
            failure: undefined,
            provenance: [...node.provenance, ...provenance],
        });
        this.appendLedger({
            type: 'dag.node.completed',
            run_id: this.ledgerRunId,
            dag_id: this.dagId,
            node_id: updated.id,
            artifact_refs: provenance
                .filter((link) => link.kind === 'artifact')
                .map((link) => link.ref),
        });
        this.appendLedger({
            type: 'dag.lease.released',
            run_id: this.ledgerRunId,
            dag_id: this.dagId,
            node_id: updated.id,
            owner: (_a = node.lease) === null || _a === void 0 ? void 0 : _a.owner,
            reason: 'completed',
        });
        this.markNewlyReady();
        return cloneNode(updated);
    }
    failNode(nodeId, reason, retryable) {
        var _a;
        const node = this.requireNode(nodeId);
        const updated = this.updateNode(node, {
            status: retryable ? 'pending' : 'failed',
            lease: undefined,
            failure: { reason, retryable },
        });
        this.appendLedger({
            type: 'dag.node.failed',
            run_id: this.ledgerRunId,
            dag_id: this.dagId,
            node_id: updated.id,
            reason,
            retryable,
        });
        this.appendLedger({
            type: 'dag.lease.released',
            run_id: this.ledgerRunId,
            dag_id: this.dagId,
            node_id: updated.id,
            owner: (_a = node.lease) === null || _a === void 0 ? void 0 : _a.owner,
            reason: retryable ? 'retryable_failure' : 'failed',
        });
        return cloneNode(updated);
    }
    cancelNode(nodeId) {
        var _a;
        const node = this.requireNode(nodeId);
        const updated = this.updateNode(node, {
            status: 'cancelled',
            lease: undefined,
        });
        this.appendLedger({
            type: 'dag.lease.released',
            run_id: this.ledgerRunId,
            dag_id: this.dagId,
            node_id: updated.id,
            owner: (_a = node.lease) === null || _a === void 0 ? void 0 : _a.owner,
            reason: 'cancelled',
        });
        return cloneNode(updated);
    }
    addProvenance(nodeId, link) {
        const node = this.requireNode(nodeId);
        const updated = this.updateNode(node, {
            provenance: [...node.provenance, link],
        });
        return cloneNode(updated);
    }
    reclaimExpiredLeases() {
        var _a;
        const reclaimed = [];
        for (const node of this.nodes.values()) {
            if ((node.status === 'leased' || node.status === 'running') && this.isLeaseExpired(node)) {
                const updated = this.updateNode(node, {
                    status: 'pending',
                    lease: undefined,
                    failure: { reason: 'lease_expired', retryable: true },
                });
                this.appendLedger({
                    type: 'dag.lease.released',
                    run_id: this.ledgerRunId,
                    dag_id: this.dagId,
                    node_id: updated.id,
                    owner: (_a = node.lease) === null || _a === void 0 ? void 0 : _a.owner,
                    reason: 'lease_expired',
                });
                reclaimed.push(cloneNode(updated));
            }
        }
        return reclaimed;
    }
    flushLedger() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ledgerWriteChain;
        });
    }
    flush() {
        if (!this.storePath)
            return;
        mkdirSync(dirname(this.storePath), { recursive: true });
        const tmp = `${this.storePath}.tmp`;
        writeFileSync(tmp, JSON.stringify(Array.from(this.nodes.values()), null, 2), 'utf8');
        renameSync(tmp, this.storePath);
    }
    load() {
        if (!this.storePath || !existsSync(this.storePath))
            return;
        const raw = readFileSync(this.storePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            throw new Error('DurableDag: persisted store must be an array');
        for (const node of parsed) {
            this.nodes.set(node.id, node);
        }
        this.markNewlyReady();
    }
    findActiveByIdempotencyKey(idempotencyKey) {
        return Array.from(this.nodes.values()).find((node) => node.idempotencyKey === idempotencyKey && !isTerminal(node.status));
    }
    requireNode(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node)
            throw new Error(`DurableDag: unknown node "${nodeId}"`);
        return node;
    }
    dependenciesSatisfied(node) {
        return node.dependsOn.every((depId) => { var _a; return ((_a = this.nodes.get(depId)) === null || _a === void 0 ? void 0 : _a.status) === 'succeeded'; });
    }
    isLeaseExpired(node) {
        return node.lease !== undefined && node.lease.expiresAt <= this.clock();
    }
    markNewlyReady() {
        let changed = false;
        for (const node of this.nodes.values()) {
            if (node.status === 'pending' && this.dependenciesSatisfied(node)) {
                node.status = 'ready';
                node.updatedAt = this.clock();
                this.appendLedger({
                    type: 'dag.node.ready',
                    run_id: this.ledgerRunId,
                    dag_id: this.dagId,
                    node_id: node.id,
                    kind: node.kind,
                    idempotency_key: node.idempotencyKey,
                });
                changed = true;
            }
        }
        if (changed)
            this.flush();
    }
    updateNode(node, patch) {
        const updated = Object.assign(Object.assign(Object.assign({}, node), patch), { payload: patch.payload ? Object.assign({}, patch.payload) : node.payload, dependsOn: patch.dependsOn ? [...patch.dependsOn] : node.dependsOn, provenance: patch.provenance ? [...patch.provenance] : node.provenance, updatedAt: this.clock() });
        this.nodes.set(updated.id, updated);
        this.flush();
        return updated;
    }
    appendLedger(event) {
        if (!this.ledger)
            return;
        const write = this.ledgerWriteChain.then(() => this.ledger.append(event));
        this.ledgerWriteChain = write.then(() => undefined, () => undefined);
    }
}

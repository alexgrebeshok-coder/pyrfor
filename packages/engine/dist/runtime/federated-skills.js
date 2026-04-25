/**
 * federated-skills.ts — Pyrfor federated skill-sharing module.
 *
 * Peers exchange FederatedSkill definitions over HTTP:
 *   GET  ${peer.url}/skills   → FederatedSkill[]   (served by exportLocal())
 *
 * Signature model:
 *   - publish() signs payload with SHA-256( JSON.stringify(payload) + nodeId )
 *   - syncFromPeer() verifies incoming skills: if custom verifier is provided,
 *     always call it; otherwise use the default SHA-256 verifier only when the
 *     remote skill carries a signature field.
 *
 * Timeout: uses Promise.race + setTimeout so vitest fake timers work correctly.
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
import { createHash } from 'node:crypto';
// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256Hex(data) {
    return createHash('sha256').update(data).digest('hex');
}
function defaultSign(payload, nodeId) {
    return sha256Hex(JSON.stringify(payload) + nodeId);
}
function defaultVerify(payload, sig, sourceNodeId) {
    return defaultSign(payload, sourceNodeId) === sig;
}
// ── Factory ───────────────────────────────────────────────────────────────────
export function createFederatedSkillsClient(opts) {
    const { nodeId, httpFetch = globalThis.fetch, signer, verifier, localStore, timeoutMs = 5000, } = opts;
    // ── internal state ────────────────────────────────────────────────────────
    const peers = new Map();
    const listeners = new Map();
    // ── event helpers ─────────────────────────────────────────────────────────
    function emit(event, payload) {
        var _a;
        (_a = listeners.get(event)) === null || _a === void 0 ? void 0 : _a.forEach((cb) => cb(payload));
    }
    function on(event, cb) {
        if (!listeners.has(event))
            listeners.set(event, new Set());
        listeners.get(event).add(cb);
        return () => { var _a; return (_a = listeners.get(event)) === null || _a === void 0 ? void 0 : _a.delete(cb); };
    }
    // ── sign / verify helpers ─────────────────────────────────────────────────
    function sign(payload) {
        return signer ? signer(payload) : defaultSign(payload, nodeId);
    }
    function verify(payload, sig, sourceNodeId) {
        return verifier
            ? verifier(payload, sig, sourceNodeId)
            : defaultVerify(payload, sig, sourceNodeId);
    }
    // ── fetch with timeout ────────────────────────────────────────────────────
    function fetchWithTimeout(url) {
        return __awaiter(this, void 0, void 0, function* () {
            let timerId;
            const timeoutPromise = new Promise((_, reject) => {
                timerId = setTimeout(() => reject(new Error(`Fetch timed out after ${timeoutMs}ms`)), timeoutMs);
            });
            try {
                const res = yield Promise.race([httpFetch(url), timeoutPromise]);
                clearTimeout(timerId);
                return res;
            }
            catch (e) {
                clearTimeout(timerId);
                throw e;
            }
        });
    }
    // ── peer management ───────────────────────────────────────────────────────
    function addPeer(peer) {
        peers.set(peer.id, Object.assign({}, peer));
        emit('peerAdded', Object.assign({}, peer));
    }
    function removePeer(peerId) {
        const peer = peers.get(peerId);
        if (peer) {
            peers.delete(peerId);
            emit('peerRemoved', Object.assign({}, peer));
        }
    }
    function listPeers() {
        return [...peers.values()];
    }
    // ── publish ───────────────────────────────────────────────────────────────
    function publish(skill) {
        const signature = sign(skill.payload);
        const full = Object.assign(Object.assign({}, skill), { sourceNodeId: nodeId, signature });
        localStore.upsert(full);
        return full;
    }
    // ── sync from single peer ─────────────────────────────────────────────────
    function syncFromPeer(peerId) {
        return __awaiter(this, void 0, void 0, function* () {
            const peer = peers.get(peerId);
            if (!peer)
                throw new Error(`Unknown peer: ${peerId}`);
            emit('syncStart', { peerId });
            let pulled = 0;
            let rejected = 0;
            let res;
            try {
                res = yield fetchWithTimeout(`${peer.url}/skills`);
                if (!res.ok)
                    throw new Error(`HTTP ${res.status}`);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                peers.set(peerId, Object.assign(Object.assign({}, peer), { lastError: msg }));
                emit('syncError', { peerId, error: msg });
                emit('syncEnd', { peerId, pulled, rejected });
                throw err;
            }
            let data;
            try {
                data = yield res.json();
            }
            catch (_a) {
                const msg = 'Invalid JSON in response';
                peers.set(peerId, Object.assign(Object.assign({}, peer), { lastError: msg }));
                emit('syncError', { peerId, error: msg });
                emit('syncEnd', { peerId, pulled, rejected });
                throw new Error(msg);
            }
            if (!Array.isArray(data)) {
                const msg = 'Expected JSON array from peer';
                peers.set(peerId, Object.assign(Object.assign({}, peer), { lastError: msg }));
                emit('syncError', { peerId, error: msg });
                emit('syncEnd', { peerId, pulled, rejected });
                throw new Error(msg);
            }
            for (const item of data) {
                try {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) {
                        throw new Error('Entry is not an object');
                    }
                    const s = item;
                    if (typeof s.id !== 'string' || !s.id)
                        throw new Error('Missing or invalid id');
                    if (typeof s.name !== 'string' || !s.name)
                        throw new Error('Missing or invalid name');
                    if (typeof s.sourceNodeId !== 'string')
                        throw new Error('Missing sourceNodeId');
                    const version = typeof s.version === 'number' ? s.version : 0;
                    // Signature check: custom verifier always runs; default runs only when
                    // signature is present on the remote skill.
                    const hasSig = typeof s.signature === 'string';
                    if (verifier || hasSig) {
                        const sig = hasSig ? s.signature : '';
                        if (!verify(s.payload, sig, s.sourceNodeId)) {
                            emit('skillRejected', { skill: s, reason: 'bad signature' });
                            rejected++;
                            continue;
                        }
                    }
                    // Skip if we already have an equal or newer version.
                    const existing = localStore.get(s.id);
                    if (existing && existing.version >= version) {
                        continue;
                    }
                    const skill = {
                        id: s.id,
                        name: s.name,
                        version,
                        payload: s.payload,
                        signature: hasSig ? s.signature : undefined,
                        sourceNodeId: s.sourceNodeId,
                        receivedAt: Date.now(),
                    };
                    localStore.upsert(skill);
                    emit('skillReceived', skill);
                    pulled++;
                }
                catch (err) {
                    emit('skillRejected', { item, reason: err instanceof Error ? err.message : String(err) });
                    rejected++;
                }
            }
            peers.set(peerId, Object.assign(Object.assign({}, peer), { lastSyncAt: Date.now(), lastError: undefined }));
            emit('syncEnd', { peerId, pulled, rejected });
            return { pulled, rejected };
        });
    }
    // ── sync from all peers ───────────────────────────────────────────────────
    function syncFromAllPeers() {
        return __awaiter(this, void 0, void 0, function* () {
            const peerIds = [...peers.keys()];
            const settled = yield Promise.allSettled(peerIds.map((peerId) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const { pulled, rejected } = yield syncFromPeer(peerId);
                    return { peer: peerId, pulled, rejected };
                }
                catch (err) {
                    return {
                        peer: peerId,
                        pulled: 0,
                        rejected: 0,
                        error: err instanceof Error ? err.message : String(err),
                    };
                }
            })));
            return settled.map((r) => r.status === 'fulfilled'
                ? r.value
                : { peer: '', pulled: 0, rejected: 0, error: 'internal error' });
        });
    }
    // ── export ────────────────────────────────────────────────────────────────
    function exportLocal() {
        return localStore.list();
    }
    // ── public interface ──────────────────────────────────────────────────────
    return {
        addPeer,
        removePeer,
        listPeers,
        publish,
        syncFromPeer,
        syncFromAllPeers,
        exportLocal,
        on,
    };
}

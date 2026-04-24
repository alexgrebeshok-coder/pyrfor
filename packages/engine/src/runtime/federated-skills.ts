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

import { createHash } from 'node:crypto';

// ── Public types ──────────────────────────────────────────────────────────────

export type FederatedSkill = {
  id: string;
  name: string;
  version: number;
  payload: unknown;
  signature?: string;
  sourceNodeId: string;
  receivedAt?: number;
};

export type Peer = {
  id: string;
  url: string;
  lastSyncAt?: number;
  lastError?: string;
};

export type EventName =
  | 'peerAdded'
  | 'peerRemoved'
  | 'syncStart'
  | 'syncEnd'
  | 'syncError'
  | 'skillReceived'
  | 'skillRejected';

export type LocalStore = {
  list(): FederatedSkill[];
  upsert(s: FederatedSkill): void;
  get(id: string): FederatedSkill | undefined;
};

export type FederatedSkillsClientOpts = {
  nodeId: string;
  httpFetch?: typeof fetch;
  signer?: (payload: unknown) => string;
  verifier?: (payload: unknown, sig: string, sourceNodeId: string) => boolean;
  localStore: LocalStore;
  timeoutMs?: number;
};

export type SyncPeerResult = {
  peer: string;
  pulled: number;
  rejected: number;
  error?: string;
};

export type FederatedSkillsClient = ReturnType<typeof createFederatedSkillsClient>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function defaultSign(payload: unknown, nodeId: string): string {
  return sha256Hex(JSON.stringify(payload) + nodeId);
}

function defaultVerify(payload: unknown, sig: string, sourceNodeId: string): boolean {
  return defaultSign(payload, sourceNodeId) === sig;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createFederatedSkillsClient(opts: FederatedSkillsClientOpts) {
  const {
    nodeId,
    httpFetch = globalThis.fetch,
    signer,
    verifier,
    localStore,
    timeoutMs = 5_000,
  } = opts;

  // ── internal state ────────────────────────────────────────────────────────

  const peers = new Map<string, Peer>();
  const listeners = new Map<EventName, Set<(payload?: unknown) => void>>();

  // ── event helpers ─────────────────────────────────────────────────────────

  function emit(event: EventName, payload?: unknown): void {
    listeners.get(event)?.forEach((cb) => cb(payload));
  }

  function on(event: EventName, cb: (payload?: unknown) => void): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
    return () => listeners.get(event)?.delete(cb);
  }

  // ── sign / verify helpers ─────────────────────────────────────────────────

  function sign(payload: unknown): string {
    return signer ? signer(payload) : defaultSign(payload, nodeId);
  }

  function verify(payload: unknown, sig: string, sourceNodeId: string): boolean {
    return verifier
      ? verifier(payload, sig, sourceNodeId)
      : defaultVerify(payload, sig, sourceNodeId);
  }

  // ── fetch with timeout ────────────────────────────────────────────────────

  async function fetchWithTimeout(url: string): Promise<Response> {
    let timerId!: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<Response>((_, reject) => {
      timerId = setTimeout(
        () => reject(new Error(`Fetch timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      const res = await Promise.race([httpFetch(url), timeoutPromise]);
      clearTimeout(timerId);
      return res;
    } catch (e) {
      clearTimeout(timerId);
      throw e;
    }
  }

  // ── peer management ───────────────────────────────────────────────────────

  function addPeer(peer: Peer): void {
    peers.set(peer.id, { ...peer });
    emit('peerAdded', { ...peer });
  }

  function removePeer(peerId: string): void {
    const peer = peers.get(peerId);
    if (peer) {
      peers.delete(peerId);
      emit('peerRemoved', { ...peer });
    }
  }

  function listPeers(): Peer[] {
    return [...peers.values()];
  }

  // ── publish ───────────────────────────────────────────────────────────────

  function publish(
    skill: Omit<FederatedSkill, 'sourceNodeId' | 'signature' | 'receivedAt'>,
  ): FederatedSkill {
    const signature = sign(skill.payload);
    const full: FederatedSkill = {
      ...skill,
      sourceNodeId: nodeId,
      signature,
    };
    localStore.upsert(full);
    return full;
  }

  // ── sync from single peer ─────────────────────────────────────────────────

  async function syncFromPeer(peerId: string): Promise<{ pulled: number; rejected: number }> {
    const peer = peers.get(peerId);
    if (!peer) throw new Error(`Unknown peer: ${peerId}`);

    emit('syncStart', { peerId });

    let pulled = 0;
    let rejected = 0;

    let res: Response;
    try {
      res = await fetchWithTimeout(`${peer.url}/skills`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      peers.set(peerId, { ...peer, lastError: msg });
      emit('syncError', { peerId, error: msg });
      emit('syncEnd', { peerId, pulled, rejected });
      throw err;
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      const msg = 'Invalid JSON in response';
      peers.set(peerId, { ...peer, lastError: msg });
      emit('syncError', { peerId, error: msg });
      emit('syncEnd', { peerId, pulled, rejected });
      throw new Error(msg);
    }

    if (!Array.isArray(data)) {
      const msg = 'Expected JSON array from peer';
      peers.set(peerId, { ...peer, lastError: msg });
      emit('syncError', { peerId, error: msg });
      emit('syncEnd', { peerId, pulled, rejected });
      throw new Error(msg);
    }

    for (const item of data) {
      try {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('Entry is not an object');
        }
        const s = item as Record<string, unknown>;
        if (typeof s.id !== 'string' || !s.id) throw new Error('Missing or invalid id');
        if (typeof s.name !== 'string' || !s.name) throw new Error('Missing or invalid name');
        if (typeof s.sourceNodeId !== 'string') throw new Error('Missing sourceNodeId');

        const version = typeof s.version === 'number' ? s.version : 0;

        // Signature check: custom verifier always runs; default runs only when
        // signature is present on the remote skill.
        const hasSig = typeof s.signature === 'string';
        if (verifier || hasSig) {
          const sig = hasSig ? (s.signature as string) : '';
          if (!verify(s.payload, sig, s.sourceNodeId as string)) {
            emit('skillRejected', { skill: s, reason: 'bad signature' });
            rejected++;
            continue;
          }
        }

        // Skip if we already have an equal or newer version.
        const existing = localStore.get(s.id as string);
        if (existing && existing.version >= version) {
          continue;
        }

        const skill: FederatedSkill = {
          id: s.id as string,
          name: s.name as string,
          version,
          payload: s.payload,
          signature: hasSig ? (s.signature as string) : undefined,
          sourceNodeId: s.sourceNodeId as string,
          receivedAt: Date.now(),
        };

        localStore.upsert(skill);
        emit('skillReceived', skill);
        pulled++;
      } catch (err) {
        emit('skillRejected', { item, reason: err instanceof Error ? err.message : String(err) });
        rejected++;
      }
    }

    peers.set(peerId, { ...peer, lastSyncAt: Date.now(), lastError: undefined });
    emit('syncEnd', { peerId, pulled, rejected });

    return { pulled, rejected };
  }

  // ── sync from all peers ───────────────────────────────────────────────────

  async function syncFromAllPeers(): Promise<SyncPeerResult[]> {
    const peerIds = [...peers.keys()];

    const settled = await Promise.allSettled(
      peerIds.map(async (peerId): Promise<SyncPeerResult> => {
        try {
          const { pulled, rejected } = await syncFromPeer(peerId);
          return { peer: peerId, pulled, rejected };
        } catch (err) {
          return {
            peer: peerId,
            pulled: 0,
            rejected: 0,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    return settled.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { peer: '', pulled: 0, rejected: 0, error: 'internal error' },
    );
  }

  // ── export ────────────────────────────────────────────────────────────────

  function exportLocal(): FederatedSkill[] {
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

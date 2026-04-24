// @vitest-environment node
/**
 * Tests for packages/engine/src/runtime/federated-skills.ts
 *
 * All HTTP is intercepted via injected httpFetch — no real network.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createFederatedSkillsClient,
  type FederatedSkill,
  type Peer,
  type LocalStore,
} from './federated-skills.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStore(): LocalStore & { _data: Map<string, FederatedSkill> } {
  const _data = new Map<string, FederatedSkill>();
  return {
    _data,
    list: () => [..._data.values()],
    upsert: (s) => _data.set(s.id, s),
    get: (id) => _data.get(id),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(
  handler: (url: string) => Response | Promise<Response>,
): typeof fetch {
  return (url: RequestInfo | URL) => Promise.resolve(handler(String(url)));
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function makePeer(overrides: Partial<Peer> = {}): Peer {
  return { id: 'peer1', url: 'http://peer1.test', ...overrides };
}

function makeSkill(
  overrides: Partial<Omit<FederatedSkill, 'sourceNodeId' | 'signature' | 'receivedAt'>> = {},
): Omit<FederatedSkill, 'sourceNodeId' | 'signature' | 'receivedAt'> {
  return { id: 'skill-1', name: 'My Skill', version: 1, payload: { steps: ['a'] }, ...overrides };
}

// ── addPeer / removePeer / listPeers ──────────────────────────────────────────

describe('peer management', () => {
  it('addPeer stores the peer and listPeers returns it', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    client.addPeer(makePeer());
    expect(client.listPeers()).toHaveLength(1);
    expect(client.listPeers()[0].id).toBe('peer1');
  });

  it('listPeers returns empty array initially', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    expect(client.listPeers()).toEqual([]);
  });

  it('addPeer emits peerAdded event', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    const events: unknown[] = [];
    client.on('peerAdded', (p) => events.push(p));
    client.addPeer(makePeer());
    expect(events).toHaveLength(1);
    expect((events[0] as Peer).id).toBe('peer1');
  });

  it('addPeer overwrites existing peer with same id', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    client.addPeer(makePeer({ url: 'http://old.test' }));
    client.addPeer(makePeer({ url: 'http://new.test' }));
    expect(client.listPeers()).toHaveLength(1);
    expect(client.listPeers()[0].url).toBe('http://new.test');
  });

  it('removePeer removes the peer', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    client.addPeer(makePeer());
    client.removePeer('peer1');
    expect(client.listPeers()).toHaveLength(0);
  });

  it('removePeer emits peerRemoved event', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    const events: unknown[] = [];
    client.on('peerRemoved', (p) => events.push(p));
    client.addPeer(makePeer());
    client.removePeer('peer1');
    expect(events).toHaveLength(1);
    expect((events[0] as Peer).id).toBe('peer1');
  });

  it('removePeer is a no-op for unknown id', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    const events: unknown[] = [];
    client.on('peerRemoved', (p) => events.push(p));
    client.removePeer('nonexistent');
    expect(events).toHaveLength(0);
  });

  it('listPeers returns all added peers', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    client.addPeer(makePeer({ id: 'p1' }));
    client.addPeer(makePeer({ id: 'p2' }));
    client.addPeer(makePeer({ id: 'p3' }));
    expect(client.listPeers()).toHaveLength(3);
  });
});

// ── publish ───────────────────────────────────────────────────────────────────

describe('publish', () => {
  it('publish stores skill locally', () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: store });
    client.publish(makeSkill());
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].id).toBe('skill-1');
  });

  it('publish sets sourceNodeId to nodeId', () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({ nodeId: 'my-node', localStore: store });
    const s = client.publish(makeSkill());
    expect(s.sourceNodeId).toBe('my-node');
  });

  it('publish computes default SHA-256 signature', () => {
    const store = makeStore();
    const nodeId = 'my-node';
    const client = createFederatedSkillsClient({ nodeId, localStore: store });
    const skill = makeSkill();
    const s = client.publish(skill);
    const expected = sha256Hex(JSON.stringify(skill.payload) + nodeId);
    expect(s.signature).toBe(expected);
  });

  it('publish returns the full FederatedSkill object', () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: store });
    const s = client.publish(makeSkill());
    expect(s).toMatchObject({ id: 'skill-1', name: 'My Skill', version: 1 });
    expect(s.signature).toBeTruthy();
  });

  it('publish uses custom signer when provided', () => {
    const store = makeStore();
    const customSigner = vi.fn((_payload: unknown) => 'custom-sig-xyz');
    const client = createFederatedSkillsClient({
      nodeId: 'n1',
      localStore: store,
      signer: customSigner,
    });
    const s = client.publish(makeSkill());
    expect(customSigner).toHaveBeenCalledWith(makeSkill().payload);
    expect(s.signature).toBe('custom-sig-xyz');
  });
});

// ── syncFromPeer — happy path ─────────────────────────────────────────────────

describe('syncFromPeer — happy path', () => {
  it('pulls a new remote skill', async () => {
    const store = makeStore();
    const nodeId = 'remote-node';
    const remoteSkill: FederatedSkill = {
      id: 'skill-1',
      name: 'Remote Skill',
      version: 1,
      payload: { x: 1 },
      sourceNodeId: nodeId,
      signature: sha256Hex(JSON.stringify({ x: 1 }) + nodeId),
    };
    const client = createFederatedSkillsClient({
      nodeId: 'local-node',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse([remoteSkill])),
    });
    client.addPeer(makePeer());
    const { pulled, rejected } = await client.syncFromPeer('peer1');
    expect(pulled).toBe(1);
    expect(rejected).toBe(0);
    expect(store.get('skill-1')).toBeDefined();
  });

  it('sets receivedAt on upserted skill', async () => {
    const store = makeStore();
    const nodeId = 'rn';
    const remoteSkill: FederatedSkill = {
      id: 'sk-1',
      name: 'S',
      version: 1,
      payload: {},
      sourceNodeId: nodeId,
      signature: sha256Hex(JSON.stringify({}) + nodeId),
    };
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse([remoteSkill])),
    });
    client.addPeer(makePeer());
    await client.syncFromPeer('peer1');
    expect(store.get('sk-1')!.receivedAt).toBeTypeOf('number');
  });

  it('updates peer lastSyncAt after successful sync', async () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse([])),
    });
    client.addPeer(makePeer());
    await client.syncFromPeer('peer1');
    const peer = client.listPeers()[0];
    expect(peer.lastSyncAt).toBeTypeOf('number');
  });
});

// ── syncFromPeer — version skipping ──────────────────────────────────────────

describe('syncFromPeer — version rules', () => {
  function makeRemote(version: number, nodeId = 'rn'): FederatedSkill {
    return {
      id: 'skill-1',
      name: 'S',
      version,
      payload: { v: version },
      sourceNodeId: nodeId,
      signature: sha256Hex(JSON.stringify({ v: version }) + nodeId),
    };
  }

  it('skips when local version equals remote version', async () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse([makeRemote(2)])),
    });
    store.upsert({ id: 'skill-1', name: 'S', version: 2, payload: {}, sourceNodeId: 'ln' });
    client.addPeer(makePeer());
    const { pulled } = await client.syncFromPeer('peer1');
    expect(pulled).toBe(0);
  });

  it('skips when local version is newer than remote', async () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse([makeRemote(1)])),
    });
    store.upsert({ id: 'skill-1', name: 'S', version: 5, payload: {}, sourceNodeId: 'ln' });
    client.addPeer(makePeer());
    const { pulled } = await client.syncFromPeer('peer1');
    expect(pulled).toBe(0);
  });

  it('pulls when remote version is newer', async () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse([makeRemote(10)])),
    });
    store.upsert({ id: 'skill-1', name: 'S', version: 3, payload: {}, sourceNodeId: 'ln' });
    client.addPeer(makePeer());
    const { pulled } = await client.syncFromPeer('peer1');
    expect(pulled).toBe(1);
    expect(store.get('skill-1')!.version).toBe(10);
  });
});

// ── syncFromPeer — rejection cases ────────────────────────────────────────────

describe('syncFromPeer — malformed entries', () => {
  async function syncWithItems(items: unknown[]): Promise<{ pulled: number; rejected: number }> {
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse(items)),
    });
    client.addPeer(makePeer());
    return client.syncFromPeer('peer1');
  }

  it('rejects entry missing id field', async () => {
    const { rejected } = await syncWithItems([{ name: 'S', version: 1, sourceNodeId: 'rn' }]);
    expect(rejected).toBe(1);
  });

  it('rejects entry missing name field', async () => {
    const { rejected } = await syncWithItems([{ id: 'x', version: 1, sourceNodeId: 'rn' }]);
    expect(rejected).toBe(1);
  });

  it('rejects entry missing sourceNodeId', async () => {
    const { rejected } = await syncWithItems([{ id: 'x', name: 'S', version: 1 }]);
    expect(rejected).toBe(1);
  });

  it('rejects null entry', async () => {
    const { rejected } = await syncWithItems([null]);
    expect(rejected).toBe(1);
  });

  it('rejects array entry', async () => {
    const { rejected } = await syncWithItems([['oops']]);
    expect(rejected).toBe(1);
  });

  it('handles mix of good and bad entries', async () => {
    const nodeId = 'rn';
    const good: FederatedSkill = {
      id: 'g1',
      name: 'Good',
      version: 1,
      payload: {},
      sourceNodeId: nodeId,
      signature: sha256Hex(JSON.stringify({}) + nodeId),
    };
    const { pulled, rejected } = await syncWithItems([good, null, { bad: true }]);
    expect(pulled).toBe(1);
    expect(rejected).toBe(2);
  });
});

// ── syncFromPeer — signature verification ─────────────────────────────────────

describe('syncFromPeer — signature verification', () => {
  it('rejects skill with tampered payload (default verifier)', async () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() =>
        jsonResponse([
          {
            id: 'sk1',
            name: 'S',
            version: 1,
            payload: { tampered: true }, // payload changed after signing
            sourceNodeId: 'rn',
            signature: sha256Hex(JSON.stringify({ original: true }) + 'rn'), // signed with different payload
          },
        ]),
      ),
    });
    client.addPeer(makePeer());
    const { rejected } = await client.syncFromPeer('peer1');
    expect(rejected).toBe(1);
  });

  it('accepts skill with valid default signature', async () => {
    const store = makeStore();
    const nodeId = 'rn';
    const payload = { steps: ['x', 'y'] };
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() =>
        jsonResponse([
          {
            id: 'sk1',
            name: 'S',
            version: 1,
            payload,
            sourceNodeId: nodeId,
            signature: sha256Hex(JSON.stringify(payload) + nodeId),
          },
        ]),
      ),
    });
    client.addPeer(makePeer());
    const { pulled } = await client.syncFromPeer('peer1');
    expect(pulled).toBe(1);
  });

  it('uses custom verifier when provided', async () => {
    const store = makeStore();
    const customVerifier = vi.fn(() => true);
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      verifier: customVerifier,
      httpFetch: mockFetch(() =>
        jsonResponse([
          { id: 'sk1', name: 'S', version: 1, payload: {}, sourceNodeId: 'rn', signature: 'any-sig' },
        ]),
      ),
    });
    client.addPeer(makePeer());
    await client.syncFromPeer('peer1');
    expect(customVerifier).toHaveBeenCalledWith({}, 'any-sig', 'rn');
  });

  it('custom verifier returning false rejects skill', async () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      verifier: () => false,
      httpFetch: mockFetch(() =>
        jsonResponse([
          { id: 'sk1', name: 'S', version: 1, payload: {}, sourceNodeId: 'rn', signature: 'sig' },
        ]),
      ),
    });
    client.addPeer(makePeer());
    const { rejected } = await client.syncFromPeer('peer1');
    expect(rejected).toBe(1);
  });
});

// ── syncFromPeer — network / parse errors ─────────────────────────────────────

describe('syncFromPeer — error handling', () => {
  it('throws on network error and emits syncError', async () => {
    const store = makeStore();
    const errors: unknown[] = [];
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: () => Promise.reject(new Error('Network down')),
    });
    client.addPeer(makePeer());
    client.on('syncError', (e) => errors.push(e));
    await expect(client.syncFromPeer('peer1')).rejects.toThrow('Network down');
    expect(errors).toHaveLength(1);
  });

  it('throws on bad JSON response and emits syncError', async () => {
    const store = makeStore();
    const errors: unknown[] = [];
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: () => Promise.resolve(new Response('not-json', { status: 200 })),
    });
    client.addPeer(makePeer());
    client.on('syncError', (e) => errors.push(e));
    await expect(client.syncFromPeer('peer1')).rejects.toThrow();
    expect(errors).toHaveLength(1);
  });

  it('throws on HTTP non-ok status', async () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse({}, 500)),
    });
    client.addPeer(makePeer());
    await expect(client.syncFromPeer('peer1')).rejects.toThrow('HTTP 500');
  });

  it('throws for unknown peer id', async () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    await expect(client.syncFromPeer('ghost')).rejects.toThrow('Unknown peer: ghost');
  });

  it('stores lastError on peer after failure', async () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: () => Promise.reject(new Error('oops')),
    });
    client.addPeer(makePeer());
    await client.syncFromPeer('peer1').catch(() => {});
    expect(client.listPeers()[0].lastError).toBe('oops');
  });
});

// ── timeout ───────────────────────────────────────────────────────────────────

describe('timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out after timeoutMs using fake timers', async () => {
    vi.useFakeTimers();
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      timeoutMs: 3_000,
      // fetch never resolves
      httpFetch: () => new Promise(() => {}),
    });
    client.addPeer(makePeer());

    const syncPromise = client.syncFromPeer('peer1');
    // Advance past the timeout threshold
    vi.advanceTimersByTime(3_001);
    await expect(syncPromise).rejects.toThrow(/timed out/i);
  });

  it('does NOT time out when fetch resolves in time', async () => {
    vi.useFakeTimers();
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      timeoutMs: 5_000,
      httpFetch: () => Promise.resolve(jsonResponse([])),
    });
    client.addPeer(makePeer());

    const syncPromise = client.syncFromPeer('peer1');
    vi.advanceTimersByTime(100);
    const result = await syncPromise;
    expect(result.pulled).toBe(0);
  });
});

// ── syncFromAllPeers ──────────────────────────────────────────────────────────

describe('syncFromAllPeers', () => {
  it('returns empty array when no peers registered', async () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    const results = await client.syncFromAllPeers();
    expect(results).toEqual([]);
  });

  it('aggregates results from multiple peers', async () => {
    const nodeId = 'rn';
    const makeRemoteSkill = (id: string): FederatedSkill => ({
      id,
      name: id,
      version: 1,
      payload: {},
      sourceNodeId: nodeId,
      signature: sha256Hex(JSON.stringify({}) + nodeId),
    });

    let callCount = 0;
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => {
        callCount++;
        return jsonResponse([makeRemoteSkill(`skill-${callCount}`)]);
      }),
    });
    client.addPeer(makePeer({ id: 'p1', url: 'http://p1.test' }));
    client.addPeer(makePeer({ id: 'p2', url: 'http://p2.test' }));
    const results = await client.syncFromAllPeers();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.pulled === 1)).toBe(true);
  });

  it('isolates peer failures — success peers still succeed', async () => {
    const nodeId = 'rn';
    const goodSkill: FederatedSkill = {
      id: 'g1',
      name: 'Good',
      version: 1,
      payload: {},
      sourceNodeId: nodeId,
      signature: sha256Hex(JSON.stringify({}) + nodeId),
    };
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch((url) => {
        if (url.includes('good')) return jsonResponse([goodSkill]);
        throw new Error('bad peer down');
      }),
    });
    client.addPeer(makePeer({ id: 'good-peer', url: 'http://good.test' }));
    client.addPeer(makePeer({ id: 'bad-peer', url: 'http://bad.test' }));
    const results = await client.syncFromAllPeers();
    const goodResult = results.find((r) => r.peer === 'good-peer');
    const badResult = results.find((r) => r.peer === 'bad-peer');
    expect(goodResult?.pulled).toBe(1);
    expect(badResult?.error).toBeTruthy();
  });

  it('sets error field for failed peers', async () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: () => Promise.reject(new Error('connection refused')),
    });
    client.addPeer(makePeer({ id: 'down-peer' }));
    const results = await client.syncFromAllPeers();
    expect(results[0].error).toBeTruthy();
  });
});

// ── events ────────────────────────────────────────────────────────────────────

describe('events', () => {
  it('syncStart fires before syncEnd', async () => {
    const store = makeStore();
    const order: string[] = [];
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse([])),
    });
    client.addPeer(makePeer());
    client.on('syncStart', () => order.push('start'));
    client.on('syncEnd', () => order.push('end'));
    await client.syncFromPeer('peer1');
    expect(order).toEqual(['start', 'end']);
  });

  it('skillReceived fires for each pulled skill', async () => {
    const store = makeStore();
    const nodeId = 'rn';
    const skills: FederatedSkill[] = [1, 2].map((v) => ({
      id: `s${v}`,
      name: `S${v}`,
      version: v,
      payload: { v },
      sourceNodeId: nodeId,
      signature: sha256Hex(JSON.stringify({ v }) + nodeId),
    }));
    const received: unknown[] = [];
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse(skills)),
    });
    client.addPeer(makePeer());
    client.on('skillReceived', (s) => received.push(s));
    await client.syncFromPeer('peer1');
    expect(received).toHaveLength(2);
  });

  it('skillRejected fires for each rejected entry', async () => {
    const store = makeStore();
    const rejected: unknown[] = [];
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: mockFetch(() => jsonResponse([null, 42])),
    });
    client.addPeer(makePeer());
    client.on('skillRejected', (e) => rejected.push(e));
    await client.syncFromPeer('peer1');
    expect(rejected).toHaveLength(2);
  });

  it('syncError fires on network failure', async () => {
    const store = makeStore();
    const errors: unknown[] = [];
    const client = createFederatedSkillsClient({
      nodeId: 'ln',
      localStore: store,
      httpFetch: () => Promise.reject(new Error('network error')),
    });
    client.addPeer(makePeer());
    client.on('syncError', (e) => errors.push(e));
    await client.syncFromPeer('peer1').catch(() => {});
    expect(errors).toHaveLength(1);
  });

  it('unsubscribe stops event delivery', async () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    const events: unknown[] = [];
    const unsub = client.on('peerAdded', (p) => events.push(p));
    client.addPeer(makePeer({ id: 'p1' }));
    unsub();
    client.addPeer(makePeer({ id: 'p2' }));
    expect(events).toHaveLength(1);
  });

  it('multiple listeners on the same event all fire', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    const calls: number[] = [];
    client.on('peerAdded', () => calls.push(1));
    client.on('peerAdded', () => calls.push(2));
    client.addPeer(makePeer());
    expect(calls).toEqual([1, 2]);
  });
});

// ── exportLocal ───────────────────────────────────────────────────────────────

describe('exportLocal', () => {
  it('returns empty array when no skills stored', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    expect(client.exportLocal()).toEqual([]);
  });

  it('returns snapshot of published skills', () => {
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: makeStore() });
    client.publish(makeSkill({ id: 'a' }));
    client.publish(makeSkill({ id: 'b' }));
    const snap = client.exportLocal();
    expect(snap).toHaveLength(2);
    expect(snap.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('exported snapshot is a copy (mutation does not affect store)', () => {
    const store = makeStore();
    const client = createFederatedSkillsClient({ nodeId: 'n1', localStore: store });
    client.publish(makeSkill({ id: 'sk1' }));
    const snap = client.exportLocal();
    // Mutating the snapshot array should not affect the store
    snap.splice(0);
    expect(store.list()).toHaveLength(1);
  });
});

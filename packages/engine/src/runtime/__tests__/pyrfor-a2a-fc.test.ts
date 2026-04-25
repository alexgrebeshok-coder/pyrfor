// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { A2aHub } from '../pyrfor-a2a-fc';

describe('A2aHub', () => {
  // ── register / unregister / subscribe / publish ─────────────────────────

  it('basic publish delivers message to subscriber', () => {
    const hub = new A2aHub();
    hub.register('agent-a');
    const received: any[] = [];
    hub.subscribe('agent-a', 'test-topic', (m) => received.push(m));
    hub.publish({ from: 'agent-a', topic: 'test-topic', payload: { x: 1 } });
    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ x: 1 });
    expect(received[0].topic).toBe('test-topic');
  });

  it('unregister removes agent subscriptions and stops delivery', () => {
    const hub = new A2aHub();
    hub.register('agent-a');
    const received: any[] = [];
    hub.subscribe('agent-a', 'topic', (m) => received.push(m));
    hub.unregister('agent-a');
    hub.publish({ from: 'agent-b', topic: 'topic', payload: {} });
    expect(received).toHaveLength(0);
  });

  // ── broadcast vs targeted ─────────────────────────────────────────────

  it('broadcast (no to) delivers to all topic subscribers', () => {
    const hub = new A2aHub();
    hub.register('agent-a');
    hub.register('agent-b');
    const rcvA: any[] = [];
    const rcvB: any[] = [];
    hub.subscribe('agent-a', 'news', (m) => rcvA.push(m));
    hub.subscribe('agent-b', 'news', (m) => rcvB.push(m));
    hub.publish({ from: 'agent-c', topic: 'news', payload: 'hello all' });
    expect(rcvA).toHaveLength(1);
    expect(rcvB).toHaveLength(1);
  });

  it('targeted message (to set) only delivered to that agent', () => {
    const hub = new A2aHub();
    hub.register('agent-a');
    hub.register('agent-b');
    const rcvA: any[] = [];
    const rcvB: any[] = [];
    hub.subscribe('agent-a', 'dm', (m) => rcvA.push(m));
    hub.subscribe('agent-b', 'dm', (m) => rcvB.push(m));
    hub.publish({ from: 'agent-c', to: 'agent-b', topic: 'dm', payload: 'secret' });
    expect(rcvA).toHaveLength(0);
    expect(rcvB).toHaveLength(1);
  });

  // ── wildcard topic ────────────────────────────────────────────────────

  it("topic '*' wildcard receives all published messages", () => {
    const hub = new A2aHub();
    hub.register('agent-a');
    const all: any[] = [];
    hub.subscribe('agent-a', '*', (m) => all.push(m));
    hub.publish({ from: 'agent-b', topic: 'alpha', payload: 1 });
    hub.publish({ from: 'agent-b', topic: 'beta', payload: 2 });
    hub.publish({ from: 'agent-b', topic: 'gamma', payload: 3 });
    expect(all).toHaveLength(3);
  });

  it("topic '*' wildcard respects targeted routing", () => {
    const hub = new A2aHub();
    hub.register('agent-a');
    hub.register('agent-b');
    const rcvA: any[] = [];
    hub.subscribe('agent-a', '*', (m) => rcvA.push(m));
    // targeted to agent-b, should not reach agent-a
    hub.publish({ from: 'agent-c', to: 'agent-b', topic: 'alpha', payload: 'x' });
    expect(rcvA).toHaveLength(0);
  });

  // ── unsubscribe ────────────────────────────────────────────────────────

  it('unsubscribe stops delivery', () => {
    const hub = new A2aHub();
    hub.register('agent-a');
    const received: any[] = [];
    const unsub = hub.subscribe('agent-a', 'topic', (m) => received.push(m));
    hub.publish({ from: 'agent-b', topic: 'topic', payload: 'first' });
    unsub();
    hub.publish({ from: 'agent-b', topic: 'topic', payload: 'second' });
    expect(received).toHaveLength(1);
    expect(received[0].payload).toBe('first');
  });

  // ── acquire / release lease ────────────────────────────────────────────

  it('acquire succeeds when key is free', () => {
    const hub = new A2aHub();
    const result = hub.acquire('mykey', 'agent-a', 5000);
    expect(result.ok).toBe(true);
    expect(result.leaseId).toBeDefined();
  });

  it('second acquire blocked while first lease is active', () => {
    const hub = new A2aHub();
    hub.acquire('mykey', 'agent-a', 5000);
    const result2 = hub.acquire('mykey', 'agent-b', 5000);
    expect(result2.ok).toBe(false);
    expect(result2.heldBy).toBe('agent-a');
  });

  it('acquire succeeds after release', () => {
    const hub = new A2aHub();
    const r1 = hub.acquire('mykey', 'agent-a', 5000);
    hub.release('mykey', r1.leaseId!);
    const r2 = hub.acquire('mykey', 'agent-b', 5000);
    expect(r2.ok).toBe(true);
  });

  // ── TTL expiry with injected clock ─────────────────────────────────────

  it('TTL expiry: expired lease allows next acquire', () => {
    let t = 1_000_000;
    const hub = new A2aHub({ now: () => t });
    hub.acquire('mykey', 'agent-a', 1000); // expires at t+1000
    t += 2000; // advance past TTL
    const r2 = hub.acquire('mykey', 'agent-b', 1000);
    expect(r2.ok).toBe(true);
    expect(r2.heldBy).toBeUndefined();
  });

  // ── set / get with lease ───────────────────────────────────────────────

  it('set with valid lease stores value; get retrieves it', () => {
    const hub = new A2aHub();
    const { leaseId } = hub.acquire('cfg', 'agent-a', 5000);
    const ok = hub.set('cfg', { version: 2 }, leaseId!);
    expect(ok).toBe(true);
    expect(hub.get('cfg')).toEqual({ version: 2 });
  });

  it('set without a lease returns false', () => {
    const hub = new A2aHub();
    const ok = hub.set('cfg', { version: 2 }, 'fake-lease-id');
    expect(ok).toBe(false);
    expect(hub.get('cfg')).toBeUndefined();
  });

  it('set with wrong leaseId returns false', () => {
    const hub = new A2aHub();
    hub.acquire('cfg', 'agent-a', 5000);
    const ok = hub.set('cfg', { version: 99 }, 'wrong-id');
    expect(ok).toBe(false);
    expect(hub.get('cfg')).toBeUndefined();
  });

  it('set after lease expiry returns false', () => {
    let t = 1_000_000;
    const hub = new A2aHub({ now: () => t });
    const { leaseId } = hub.acquire('cfg', 'agent-a', 1000);
    t += 2000; // advance past TTL
    const ok = hub.set('cfg', 'late', leaseId!);
    expect(ok).toBe(false);
  });

  // ── history ────────────────────────────────────────────────────────────

  it('history records all published messages', () => {
    const hub = new A2aHub();
    hub.publish({ from: 'a', topic: 't1', payload: 1 });
    hub.publish({ from: 'a', topic: 't2', payload: 2 });
    hub.publish({ from: 'b', topic: 't1', payload: 3 });
    const hist = hub.history();
    expect(hist).toHaveLength(3);
    expect(hist.map((m) => m.payload)).toEqual([1, 2, 3]);
  });

  it('published messages have id and ts fields', () => {
    const hub = new A2aHub({ now: () => 42_000 });
    const msg = hub.publish({ from: 'a', topic: 't', payload: null });
    expect(msg.id).toBeDefined();
    expect(msg.ts).toBe(42_000);
  });

  it('clear resets history and subscriptions', () => {
    const hub = new A2aHub();
    hub.register('agent-a');
    const received: any[] = [];
    hub.subscribe('agent-a', 'topic', (m) => received.push(m));
    hub.publish({ from: 'a', topic: 'topic', payload: 'x' });
    hub.clear();
    expect(hub.history()).toHaveLength(0);
    // subscription was cleared
    hub.publish({ from: 'a', topic: 'topic', payload: 'y' });
    expect(received).toHaveLength(1); // only the first one before clear
  });
});

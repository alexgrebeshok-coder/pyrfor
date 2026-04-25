// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createAgentRegistry, type AgentDescriptor } from './agent-registry.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentDescriptor> & { id: string; name: string }): AgentDescriptor {
  return {
    capabilities: ['code'],
    health: 'healthy',
    ...overrides,
  };
}

// ─── register / get / unregister ─────────────────────────────────────────────

describe('register / get / unregister', () => {
  it('registers and retrieves an agent', () => {
    const reg = createAgentRegistry();
    const agent = makeAgent({ id: 'a1', name: 'Alpha' });
    reg.register(agent);
    expect(reg.get('a1')).toMatchObject({ id: 'a1', name: 'Alpha' });
  });

  it('returns undefined for unknown id', () => {
    const reg = createAgentRegistry();
    expect(reg.get('nope')).toBeUndefined();
  });

  it('unregisters an existing agent', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'Alpha' }));
    expect(reg.unregister('a1')).toBe(true);
    expect(reg.get('a1')).toBeUndefined();
  });

  it('returns false when unregistering unknown agent', () => {
    const reg = createAgentRegistry();
    expect(reg.unregister('nope')).toBe(false);
  });

  it('duplicate register replaces existing entry', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'Alpha', capabilities: ['code'] }));
    reg.register(makeAgent({ id: 'a1', name: 'Alpha-v2', capabilities: ['web'] }));
    const a = reg.get('a1');
    expect(a?.name).toBe('Alpha-v2');
    expect(a?.capabilities).toEqual(['web']);
  });
});

// ─── update ───────────────────────────────────────────────────────────────────

describe('update', () => {
  it('merges patched fields', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'Alpha', cost: 5 }));
    expect(reg.update('a1', { cost: 10, name: 'Alpha-Updated' })).toBe(true);
    const a = reg.get('a1');
    expect(a?.cost).toBe(10);
    expect(a?.name).toBe('Alpha-Updated');
    expect(a?.capabilities).toEqual(['code']); // untouched
  });

  it('returns false for unknown id', () => {
    const reg = createAgentRegistry();
    expect(reg.update('nope', { cost: 1 })).toBe(false);
  });
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe('list', () => {
  it('lists all agents', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1' }));
    reg.register(makeAgent({ id: 'a2', name: 'A2' }));
    expect(reg.list()).toHaveLength(2);
  });

  it('filters by capability (exact)', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'] }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['web'] }));
    const result = reg.list({ capability: 'code' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('filters by health', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', health: 'healthy' }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', health: 'degraded' }));
    expect(reg.list({ health: 'healthy' })).toHaveLength(1);
    expect(reg.list({ health: 'degraded' })).toHaveLength(1);
  });

  it('filters by both capability and health', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'], health: 'healthy' }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['code'], health: 'degraded' }));
    const result = reg.list({ capability: 'code', health: 'healthy' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });
});

// ─── route ────────────────────────────────────────────────────────────────────

describe('route', () => {
  it('returns null for empty registry', () => {
    const reg = createAgentRegistry();
    expect(reg.route({ requiredCapabilities: ['code'] })).toBeNull();
  });

  it('returns null when no capability matches', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['web'] }));
    expect(reg.route({ requiredCapabilities: ['code'] })).toBeNull();
  });

  it('returns null when requiredCapabilities is empty', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'] }));
    expect(reg.route({ requiredCapabilities: [] })).toBeNull();
  });

  it('routes to best matching agent (exact)', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'] }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['web'] }));
    const result = reg.route({ requiredCapabilities: ['code'] });
    expect(result?.agent.id).toBe('a1');
  });

  it('matches wildcard translate:* capability', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['translate:ru'] }));
    const result = reg.route({ requiredCapabilities: ['translate:*'] });
    expect(result?.agent.id).toBe('a1');
  });

  it('matches ** wildcard against anything', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code', 'web'] }));
    const result = reg.route({ requiredCapabilities: ['**'] });
    expect(result?.agent.id).toBe('a1');
  });

  it('preferredCapabilities boost score', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'] }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['code', 'web'] }));
    const result = reg.route({ requiredCapabilities: ['code'], preferredCapabilities: ['web'] });
    expect(result?.agent.id).toBe('a2');
    expect(result?.score).toBe(10 + 3); // 10 req + 3 preferred
  });

  it('priority adds to score', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'], priority: 0 }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['code'], priority: 5 }));
    const result = reg.route({ requiredCapabilities: ['code'] });
    expect(result?.agent.id).toBe('a2');
    expect(result?.score).toBe(15); // 10 + 5
  });

  it('cost subtracts from score', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'], cost: 0 }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['code'], cost: 4 }));
    const result = reg.route({ requiredCapabilities: ['code'] });
    expect(result?.agent.id).toBe('a1');
    expect(result?.score).toBe(10); // 10 req - 0 cost
  });

  it('maxCost filter excludes pricey agents', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'], cost: 100 }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['code'], cost: 5 }));
    const result = reg.route({ requiredCapabilities: ['code'], maxCost: 10 });
    expect(result?.agent.id).toBe('a2');
  });

  it('excludeIds are skipped', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'] }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['code'] }));
    const result = reg.route({ requiredCapabilities: ['code'], excludeIds: ['a1'] });
    expect(result?.agent.id).toBe('a2');
  });

  it('healthy preferred over degraded (health penalty)', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'], health: 'degraded' }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['code'], health: 'healthy' }));
    const result = reg.route({ requiredCapabilities: ['code'] });
    expect(result?.agent.id).toBe('a2');
  });

  it('down agents are always excluded', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'], health: 'down' }));
    expect(reg.route({ requiredCapabilities: ['code'] })).toBeNull();
  });

  it('includes matched capabilities in result', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code', 'web'] }));
    const result = reg.route({ requiredCapabilities: ['code'], preferredCapabilities: ['web'] });
    expect(result?.matched).toContain('code');
    expect(result?.matched).toContain('web');
  });
});

// ─── routeAll ─────────────────────────────────────────────────────────────────

describe('routeAll', () => {
  it('returns sorted list descending by score', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'], priority: 0 }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['code'], priority: 5 }));
    reg.register(makeAgent({ id: 'a3', name: 'A3', capabilities: ['code'], priority: 2 }));
    const results = reg.routeAll({ requiredCapabilities: ['code'] });
    expect(results.map(r => r.agent.id)).toEqual(['a2', 'a3', 'a1']);
  });

  it('excludes down agents', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'], health: 'down' }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['code'] }));
    const results = reg.routeAll({ requiredCapabilities: ['code'] });
    expect(results.map(r => r.agent.id)).toEqual(['a2']);
  });

  it('returns empty array when no agents match', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['web'] }));
    expect(reg.routeAll({ requiredCapabilities: ['code'] })).toEqual([]);
  });
});

// ─── setHealth ────────────────────────────────────────────────────────────────

describe('setHealth', () => {
  it('manually overrides health', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', health: 'healthy' }));
    reg.setHealth('a1', 'degraded');
    expect(reg.get('a1')?.health).toBe('degraded');
  });

  it('no-ops for unknown id', () => {
    const reg = createAgentRegistry();
    expect(() => reg.setHealth('nope', 'down')).not.toThrow();
  });
});

// ─── heartbeat / TTL degradation ─────────────────────────────────────────────

describe('heartbeat / healthTtlMs', () => {
  it('heartbeat refreshes lastHealthAt, preventing degradation', () => {
    let now = 1000;
    const clock = () => now;
    const reg = createAgentRegistry({ clock, healthTtlMs: 500 });
    reg.register(makeAgent({ id: 'a1', name: 'A1' }));

    now = 1400; // within TTL
    reg.heartbeat('a1');

    now = 1800; // still within 500ms of last heartbeat (1400+500=1900)
    expect(reg.list({ health: 'healthy' })).toHaveLength(1);
  });

  it('expired agent is degraded to down on list', () => {
    let now = 1000;
    const clock = () => now;
    const reg = createAgentRegistry({ clock, healthTtlMs: 500 });
    reg.register(makeAgent({ id: 'a1', name: 'A1' }));

    now = 1600; // 1000 + 500 < 1600 → expired
    const result = reg.list();
    expect(result[0].health).toBe('down');
  });

  it('expired agent excluded from route', () => {
    let now = 1000;
    const clock = () => now;
    const reg = createAgentRegistry({ clock, healthTtlMs: 500 });
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'] }));

    now = 1600;
    expect(reg.route({ requiredCapabilities: ['code'] })).toBeNull();
  });

  it('healthTtlMs respected with different values', () => {
    let now = 1000;
    const clock = () => now;
    const reg = createAgentRegistry({ clock, healthTtlMs: 2000 });
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'] }));

    now = 2999; // 1000 + 2000 = 3000, not yet expired
    expect(reg.route({ requiredCapabilities: ['code'] })).not.toBeNull();

    now = 3001; // expired
    expect(reg.route({ requiredCapabilities: ['code'] })).toBeNull();
  });

  it('heartbeat restores down agent to healthy', () => {
    let now = 1000;
    const clock = () => now;
    const reg = createAgentRegistry({ clock, healthTtlMs: 500 });
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code'] }));

    now = 1600; // expired → down
    reg.list(); // trigger degradation

    reg.heartbeat('a1'); // restore
    expect(reg.get('a1')?.health).toBe('healthy');
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('returns accurate totals', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', health: 'healthy', capabilities: ['code'] }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', health: 'degraded', capabilities: ['web'] }));
    reg.register(makeAgent({ id: 'a3', name: 'A3', health: 'down', capabilities: ['code'] }));
    const stats = reg.getStats();
    expect(stats.total).toBe(3);
    expect(stats.healthy).toBe(1);
    expect(stats.degraded).toBe(1);
    expect(stats.down).toBe(1);
  });

  it('perCapability counts agents per capability', () => {
    const reg = createAgentRegistry();
    reg.register(makeAgent({ id: 'a1', name: 'A1', capabilities: ['code', 'web'] }));
    reg.register(makeAgent({ id: 'a2', name: 'A2', capabilities: ['code'] }));
    const stats = reg.getStats();
    expect(stats.perCapability['code']).toBe(2);
    expect(stats.perCapability['web']).toBe(1);
  });

  it('returns zeros for empty registry', () => {
    const reg = createAgentRegistry();
    const stats = reg.getStats();
    expect(stats).toEqual({ total: 0, healthy: 0, degraded: 0, down: 0, perCapability: {} });
  });
});

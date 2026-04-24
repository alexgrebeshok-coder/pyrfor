// agent-registry.ts — AgentRegistry for the Pyrfor engine.
// Routes messages to the best registered agent based on capabilities, cost, priority, and health.

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AgentDescriptor {
  id: string;
  name: string;
  capabilities: string[];
  cost?: number;
  priority?: number;
  health?: 'healthy' | 'degraded' | 'down';
  meta?: Record<string, unknown>;
}

export interface RouteRequest {
  requiredCapabilities: string[];
  preferredCapabilities?: string[];
  excludeIds?: string[];
  maxCost?: number;
}

export interface RouteResult {
  agent: AgentDescriptor;
  score: number;
  matched: string[];
}

// ─── Internal state ───────────────────────────────────────────────────────────

interface InternalEntry {
  agent: AgentDescriptor;
  lastHealthAt: number;
}

// ─── Capability matching ──────────────────────────────────────────────────────

function capabilityMatches(pattern: string, capability: string): boolean {
  if (pattern === '**') return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // 'translate:'
    return capability.startsWith(prefix);
  }
  return pattern === capability;
}

function agentMatchesCapability(agent: AgentDescriptor, cap: string): boolean {
  return agent.capabilities.some(c => capabilityMatches(cap, c) || capabilityMatches(c, cap));
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createAgentRegistry(opts?: { clock?: () => number; healthTtlMs?: number }) {
  const clock = opts?.clock ?? (() => Date.now());
  const healthTtlMs = opts?.healthTtlMs ?? 30_000;

  const entries = new Map<string, InternalEntry>();

  function degradeStale(): void {
    const now = clock();
    for (const entry of entries.values()) {
      if (
        entry.agent.health !== 'down' &&
        entry.lastHealthAt + healthTtlMs < now
      ) {
        entry.agent.health = 'down';
      }
    }
  }

  function register(agent: AgentDescriptor): void {
    entries.set(agent.id, {
      agent: { health: 'healthy', ...agent },
      lastHealthAt: clock(),
    });
  }

  function unregister(id: string): boolean {
    return entries.delete(id);
  }

  function update(id: string, patch: Partial<AgentDescriptor>): boolean {
    const entry = entries.get(id);
    if (!entry) return false;
    Object.assign(entry.agent, patch);
    return true;
  }

  function setHealth(id: string, health: 'healthy' | 'degraded' | 'down'): void {
    const entry = entries.get(id);
    if (!entry) return;
    entry.agent.health = health;
    entry.lastHealthAt = clock();
  }

  function heartbeat(id: string): void {
    const entry = entries.get(id);
    if (!entry) return;
    entry.lastHealthAt = clock();
    // If was down due to TTL expiry, restore to healthy on heartbeat
    if (entry.agent.health === 'down') {
      entry.agent.health = 'healthy';
    }
  }

  function get(id: string): AgentDescriptor | undefined {
    return entries.get(id)?.agent;
  }

  function list(filter?: { capability?: string; health?: 'healthy' | 'degraded' | 'down' }): AgentDescriptor[] {
    degradeStale();
    let result = Array.from(entries.values()).map(e => e.agent);
    if (filter?.capability) {
      const cap = filter.capability;
      result = result.filter(a => agentMatchesCapability(a, cap));
    }
    if (filter?.health) {
      result = result.filter(a => a.health === filter.health);
    }
    return result;
  }

  function scoreAgent(agent: AgentDescriptor, req: RouteRequest): { score: number; matched: string[] } | null {
    if (req.excludeIds?.includes(agent.id)) return null;
    if (agent.health === 'down') return null;
    if (req.maxCost !== undefined && (agent.cost ?? 0) > req.maxCost) return null;

    const matched: string[] = [];
    let score = 0;

    // Required capabilities
    for (const cap of req.requiredCapabilities) {
      if (agentMatchesCapability(agent, cap)) {
        score += 10;
        matched.push(cap);
      }
    }

    // If not all required caps matched, skip
    if (matched.length < req.requiredCapabilities.length) return null;

    // Preferred capabilities
    for (const cap of req.preferredCapabilities ?? []) {
      if (agentMatchesCapability(agent, cap)) {
        score += 3;
        matched.push(cap);
      }
    }

    // Priority and cost
    score += agent.priority ?? 0;
    score -= agent.cost ?? 0;

    // Health penalty
    if (agent.health === 'degraded') score -= 5;

    return { score, matched };
  }

  function route(req: RouteRequest): RouteResult | null {
    degradeStale();
    if (req.requiredCapabilities.length === 0) return null;

    let best: RouteResult | null = null;
    for (const entry of entries.values()) {
      const result = scoreAgent(entry.agent, req);
      if (result === null) continue;
      if (best === null || result.score > best.score) {
        best = { agent: entry.agent, ...result };
      }
    }
    return best;
  }

  function routeAll(req: RouteRequest): RouteResult[] {
    degradeStale();
    const results: RouteResult[] = [];
    for (const entry of entries.values()) {
      const result = scoreAgent(entry.agent, req);
      if (result === null) continue;
      results.push({ agent: entry.agent, ...result });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  function getStats(): {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
    perCapability: Record<string, number>;
  } {
    degradeStale();
    let healthy = 0, degraded = 0, down = 0;
    const perCapability: Record<string, number> = {};

    for (const entry of entries.values()) {
      const h = entry.agent.health ?? 'healthy';
      if (h === 'healthy') healthy++;
      else if (h === 'degraded') degraded++;
      else down++;

      for (const cap of entry.agent.capabilities) {
        perCapability[cap] = (perCapability[cap] ?? 0) + 1;
      }
    }

    return { total: entries.size, healthy, degraded, down, perCapability };
  }

  return { register, unregister, update, setHealth, heartbeat, get, list, route, routeAll, getStats };
}

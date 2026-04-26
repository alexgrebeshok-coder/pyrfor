// @vitest-environment node
/**
 * End-to-end test for the agent heartbeat (wakeup) flow.
 *
 * Architecture overview:
 *   runHeartbeatScheduler()
 *     → processHeartbeatQueue()  [uses deps-injected prisma + fetchImpl]
 *       → creates HeartbeatRun, then POSTs to gateway
 *     → the mocked fetch calls executeHeartbeatRun() directly
 *       [uses module-level prisma singleton – mocked here via vi.mock]
 *         → writes RunEvents, Checkpoints, AIRunCost
 *         → marks WakeupRequest as processed
 *
 * The two prisma instances (scheduler DI + executor module) are wired to the
 * SAME in-memory mock so all assertions can be made on one shared store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── 1. Hoist the shared in-memory store and mock prisma ───────────────────────
//    Must run before any module imports so that vi.mock factory below can
//    reference it.

const { mockPrisma, getStore, resetStore } = vi.hoisted(() => {
  interface StoreAgent {
    id: string;
    workspaceId: string;
    name: string;
    slug: string;
    role: string;
    definitionId: string | null;
    runtimeConfig: string;
    adapterType: string;
    adapterConfig: string;
    status: string;
    budgetMonthlyCents: number;
    spentMonthlyCents: number;
  }

  interface StoreWakeupRequest {
    id: string;
    agentId: string;
    reason: string;
    triggerData: string;
    status: string;
    idempotencyKey: string | null;
    retryCount: number;
    maxRetries: number;
    availableAt: Date;
    createdAt: Date;
    processedAt: Date | null;
    lastError: string | null;
    lastErrorType: string | null;
    // embedded agent for scheduler findMany
    agent: {
      workspaceId: string;
      status: string;
      runtimeState: null;
    };
  }

  interface StoreHeartbeatRun {
    id: string;
    [key: string]: unknown;
  }

  interface StoreDb {
    agents: Map<string, StoreAgent>;
    wakeupRequests: Map<string, StoreWakeupRequest>;
    heartbeatRuns: Map<string, StoreHeartbeatRun>;
    events: unknown[];
    checkpoints: unknown[];
    aiRunCosts: unknown[];
    runtimeStates: Map<string, unknown>;
  }

  const db: StoreDb = {
    agents: new Map(),
    wakeupRequests: new Map(),
    heartbeatRuns: new Map(),
    events: [],
    checkpoints: [],
    aiRunCosts: [],
    runtimeStates: new Map(),
  };

  let idCounter = 0;
  function nextId(prefix: string) {
    return `${prefix}-${++idCounter}`;
  }

  const mp = {
    agent: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(db.agents.get(where.id) ?? null)
      ),
      findUniqueOrThrow: vi.fn(({ where }: { where: { id: string } }) => {
        const a = db.agents.get(where.id);
        if (!a) throw new Error(`Agent ${where.id} not found`);
        return Promise.resolve(a);
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const a = db.agents.get(where.id);
        if (a) Object.assign(a, data);
        return Promise.resolve(a ?? null);
      }),
      findMany: vi.fn(() => Promise.resolve([] as StoreAgent[])),
    },
    agentWakeupRequest: {
      findMany: vi.fn(
        ({
          where,
        }: {
          where: {
            status?: string;
            availableAt?: { lte?: Date };
          };
        }) => {
          const now = where.availableAt?.lte ?? new Date(8_640_000_000_000_000);
          const results = [...db.wakeupRequests.values()].filter((r) => {
            if (where.status && r.status !== where.status) return false;
            if (r.availableAt > now) return false;
            return true;
          });
          return Promise.resolve(results);
        }
      ),
      findFirst: vi.fn(() => Promise.resolve(null)),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const r = db.wakeupRequests.get(where.id);
        if (!r) return Promise.resolve(null);
        // Return without the embedded agent field (mirrors real Prisma findUnique)
        const { agent: _agent, ...rest } = r;
        return Promise.resolve(rest);
      }),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const id = nextId('wr');
        const rec = { id, ...data } as StoreWakeupRequest;
        db.wakeupRequests.set(id, rec);
        return Promise.resolve(rec);
      }),
      update: vi.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const r = db.wakeupRequests.get(where.id);
          if (r) Object.assign(r, data);
          return Promise.resolve(r ?? null);
        }
      ),
    },
    heartbeatRun: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const id = nextId('run');
        const rec: StoreHeartbeatRun = { id, ...data };
        db.heartbeatRuns.set(id, rec);
        return Promise.resolve(rec);
      }),
      update: vi.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const r = db.heartbeatRuns.get(where.id);
          if (r) {
            Object.assign(r, data);
          } else {
            // Run was created by scheduler; executor may receive runId before
            // we set it up in the same store call – create it if missing.
            db.heartbeatRuns.set(where.id, { id: where.id, ...data });
          }
          return Promise.resolve(db.heartbeatRuns.get(where.id) ?? null);
        }
      ),
    },
    heartbeatRunEvent: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const rec = { id: nextId('evt'), ...data, createdAt: new Date() };
        db.events.push(rec);
        return Promise.resolve(rec);
      }),
    },
    heartbeatRunCheckpoint: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const rec = { id: nextId('cp'), ...data, createdAt: new Date() };
        db.checkpoints.push(rec);
        return Promise.resolve(rec);
      }),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    aIRunCost: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const rec = { id: nextId('cost'), ...data };
        db.aiRunCosts.push(rec);
        return Promise.resolve(rec);
      }),
    },
    agentRuntimeState: {
      findUnique: vi.fn(({ where }: { where: { agentId: string } }) =>
        Promise.resolve(db.runtimeStates.get(where.agentId) ?? null)
      ),
      upsert: vi.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { agentId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = db.runtimeStates.get(where.agentId);
          const next = existing
            ? { ...(existing as Record<string, unknown>), ...update }
            : { agentId: where.agentId, ...create };
          db.runtimeStates.set(where.agentId, next);
          return Promise.resolve(next);
        }
      ),
    },
  };

  return {
    mockPrisma: mp,
    getStore: () => db,
    resetStore: () => {
      db.agents.clear();
      db.wakeupRequests.clear();
      db.heartbeatRuns.clear();
      db.events.length = 0;
      db.checkpoints.length = 0;
      db.aiRunCosts.length = 0;
      db.runtimeStates.clear();
      idCounter = 0;
    },
  };
});

// ── 2. Module-level mocks (resolved before any imports below) ─────────────────

vi.mock('../../prisma', () => ({ prisma: mockPrisma }));

vi.mock('../../ai/agent-executor', () => ({
  runAgentExecution: vi.fn().mockResolvedValue({
    finalContent: 'Canned agent response from mock',
    durationMs: 42,
    aborted: false,
  }),
}));

vi.mock('../../ai/providers', () => ({
  getRouter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../transport/sse', () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock('../telegram-notify', () => ({
  sendHeartbeatTelegramNotification: vi.fn().mockResolvedValue(undefined),
  sendBudgetWarningTelegram: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../workflow-service', () => ({
  syncWorkflowStepFromHeartbeatRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../ai/agents', () => ({ aiAgents: [] }));

vi.mock('../adapters', () => ({ getAdapter: vi.fn().mockReturnValue(null) }));

vi.mock('../agent-secrets', () => ({
  resolveSecretRefs: vi.fn((config: string) => Promise.resolve(config)),
}));

// ── 3. Imports (after all vi.mock calls) ──────────────────────────────────────

import { runHeartbeatScheduler } from '../heartbeat-scheduler';
import { executeHeartbeatRun } from '../heartbeat-executor';

// ── 4. Test helpers ───────────────────────────────────────────────────────────

const AGENT_ID = 'agent-e2e-1';
const WORKSPACE_ID = 'ws-e2e-1';

function seedAgent(overrides: Partial<{
  id: string;
  status: string;
  budgetMonthlyCents: number;
}> = {}) {
  const id = overrides.id ?? AGENT_ID;
  getStore().agents.set(id, {
    id,
    workspaceId: WORKSPACE_ID,
    name: 'E2E Test Agent',
    slug: 'e2e-test-agent',
    role: 'Test',
    definitionId: null,
    runtimeConfig: '{}',
    adapterType: 'internal',
    adapterConfig: '{}',
    status: overrides.status ?? 'idle',
    budgetMonthlyCents: overrides.budgetMonthlyCents ?? 0,
    spentMonthlyCents: 0,
  });
  return id;
}

function seedWakeupRequest(opts: {
  agentId?: string;
  idempotencyKey?: string;
  status?: string;
} = {}) {
  const agentId = opts.agentId ?? AGENT_ID;
  const agent = getStore().agents.get(agentId)!;
  const id = `wr-seed-${Date.now()}-${Math.random()}`;
  const rec = {
    id,
    agentId,
    reason: 'e2e-test',
    triggerData: '{}',
    status: opts.status ?? 'queued',
    idempotencyKey: opts.idempotencyKey ?? null,
    retryCount: 0,
    maxRetries: 3,
    availableAt: new Date(Date.now() - 1000), // in the past → immediately processable
    createdAt: new Date(),
    processedAt: null,
    lastError: null,
    lastErrorType: null,
    agent: {
      workspaceId: agent?.workspaceId ?? WORKSPACE_ID,
      status: agent?.status ?? 'idle',
      runtimeState: null,
    },
  };
  getStore().wakeupRequests.set(id, rec);
  return id;
}

/**
 * Mock fetch that bridges the scheduler's HTTP dispatch to executeHeartbeatRun.
 * This is how the "e2e" wiring works: the scheduler thinks it's hitting the
 * gateway, but the mock directly invokes the executor with the same payload.
 */
async function bridgingFetch(url: string, options?: RequestInit): Promise<Response> {
  const body = JSON.parse((options?.body as string) ?? '{}');
  await executeHeartbeatRun({
    runId: body.runId,
    agentId: body.agentId,
    workspaceId: body.workspaceId,
    wakeupRequestId: body.wakeupRequestId,
    task: body.task,
  });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

// ── 5. Tests ──────────────────────────────────────────────────────────────────

describe('heartbeat e2e – full wakeup flow', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('processes a queued WakeupRequest and creates Run, Events, Checkpoints, Cost rows', async () => {
    // Arrange
    seedAgent();
    const wakeupId = seedWakeupRequest({ idempotencyKey: 'e2e-idem-1' });

    // Act
    const result = await runHeartbeatScheduler(
      { prisma: mockPrisma as never, fetchImpl: bridgingFetch as typeof fetch },
      { batchSize: 5, gatewayPort: 3999 }
    );

    // ── Assert: scheduler result ──────────────────────────────────────────────
    expect(result.queued).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);

    const store = getStore();

    // (a) HeartbeatRun created
    expect(store.heartbeatRuns.size).toBe(1);
    const [run] = [...store.heartbeatRuns.values()];
    expect(run.agentId).toBe(AGENT_ID);
    expect(run.workspaceId).toBe(WORKSPACE_ID);
    expect(run.status).toBe('succeeded');

    // (b) ≥1 RunEvent recorded
    expect(store.events.length).toBeGreaterThanOrEqual(1);
    const eventTypes = store.events.map((e: unknown) => (e as { type: string }).type);
    expect(eventTypes).toContain('completed');

    // (c) Checkpoint persisted
    expect(store.checkpoints.length).toBeGreaterThanOrEqual(1);
    const checkpointKeys = store.checkpoints.map(
      (c: unknown) => (c as { stepKey: string }).stepKey
    );
    expect(checkpointKeys).toContain('run.created');
    expect(checkpointKeys).toContain('run.completed');

    // (d) AIRunCost row recorded with mocked cost
    expect(store.aiRunCosts.length).toBe(1);
    const cost = store.aiRunCosts[0] as { runId: string; costUsd: number };
    expect(cost.runId).toBe(run.id);
    expect(typeof cost.costUsd).toBe('number');

    // (e) WakeupRequest marked processed
    const wakeup = store.wakeupRequests.get(wakeupId)!;
    expect(wakeup.status).toBe('processed');
  });

  it('idempotency: second call with same processed wakeup request creates no duplicate Run', async () => {
    // Arrange – wakeup already processed from a prior run
    seedAgent();
    seedWakeupRequest({ idempotencyKey: 'e2e-idem-dup', status: 'processed' });

    // Act – scheduler finds nothing in "queued" state
    const result = await runHeartbeatScheduler(
      { prisma: mockPrisma as never, fetchImpl: bridgingFetch as typeof fetch },
      { batchSize: 5, gatewayPort: 3999 }
    );

    const store = getStore();

    expect(result.queued).toBe(0);
    expect(result.processed).toBe(0);
    // No HeartbeatRun was created
    expect(store.heartbeatRuns.size).toBe(0);
  });

  it('skips a paused agent and marks the wakeup as skipped', async () => {
    seedAgent({ status: 'paused' });
    const wakeupId = seedWakeupRequest();

    const result = await runHeartbeatScheduler(
      { prisma: mockPrisma as never, fetchImpl: bridgingFetch as typeof fetch },
      { batchSize: 5 }
    );

    expect(result.queued).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);

    const wakeup = getStore().wakeupRequests.get(wakeupId)!;
    expect(wakeup.status).toBe('skipped');
  });
});

describe('heartbeat executor – direct invocation', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('returns succeeded status with costUsd', async () => {
    seedAgent();

    // Create the run row up-front (mimics the scheduler)
    const runRec = await mockPrisma.heartbeatRun.create({
      data: {
        workspaceId: WORKSPACE_ID,
        agentId: AGENT_ID,
        wakeupRequestId: null,
        status: 'queued',
        invocationSource: 'on_demand',
        contextSnapshot: '{}',
      },
    });

    const result = await executeHeartbeatRun({
      runId: runRec.id,
      agentId: AGENT_ID,
      workspaceId: WORKSPACE_ID,
    });

    expect(result.status).toBe('succeeded');
    expect(typeof result.costUsd).toBe('number');
    expect(result.runId).toBe(runRec.id);

    const store = getStore();
    expect(store.events.length).toBeGreaterThanOrEqual(1);
    expect(store.checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(store.aiRunCosts.length).toBe(1);
  });

  it('returns failed status when agent is paused', async () => {
    seedAgent({ status: 'paused' });

    const result = await executeHeartbeatRun({
      agentId: AGENT_ID,
      workspaceId: WORKSPACE_ID,
    });

    expect(result.status).toBe('cancelled');
    expect(result.error).toMatch(/paused/);
  });
});

// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CronService } from '../cron';
import {
  setCronPrismaClient,
  getCronPrismaClient,
  morningBriefHandler,
  emailDigestHandler,
  memoryCleanupHandler,
  healthReportHandler,
  budgetResetHandler,
  agentHeartbeatHandler,
  setHeartbeatRunner,
  getDefaultHandlers,
} from './handlers';
import type { CronExecutionContext } from '../cron';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(payload?: unknown): CronExecutionContext {
  return {
    job: {
      name: 'test-job',
      schedule: '* * * * *',
      handler: 'test',
      payload,
    },
    firedAt: new Date(),
    source: 'manual',
  };
}

function makePrisma() {
  return {
    project: {
      findMany: vi.fn().mockResolvedValue([{ name: 'P1', status: 'active', progress: 50 }]),
      count: vi.fn().mockResolvedValue(3),
    },
    task: {
      count: vi.fn().mockResolvedValue(5),
    },
    risk: {
      count: vi.fn().mockResolvedValue(2),
    },
    memory: {
      deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
      count: vi.fn().mockResolvedValue(10),
    },
    agent: {
      updateMany: vi.fn().mockResolvedValue({ count: 7 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ '1': 1 }]),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('setCronPrismaClient / getCronPrismaClient', () => {
  it('stores and retrieves the client', () => {
    const client = makePrisma();
    setCronPrismaClient(client);
    expect(getCronPrismaClient()).toBe(client);
  });
});

describe('morningBriefHandler', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    setCronPrismaClient(prisma);
  });

  it('logs a warning and returns early when chatIds is empty', async () => {
    await expect(morningBriefHandler(makeCtx({ chatIds: [] }))).resolves.toBeUndefined();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it('queries projects and tasks when chatIds provided', async () => {
    await expect(morningBriefHandler(makeCtx({ chatIds: [123] }))).resolves.toBeUndefined();
    expect(prisma.project.findMany).toHaveBeenCalledOnce();
    expect(prisma.task.count).toHaveBeenCalledTimes(2);
  });
});

describe('emailDigestHandler', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    setCronPrismaClient(prisma);
  });

  it('queries tasks and risks without throwing', async () => {
    await expect(emailDigestHandler(makeCtx())).resolves.toBeUndefined();
    expect(prisma.task.count).toHaveBeenCalledTimes(2);
    expect(prisma.risk.count).toHaveBeenCalledOnce();
  });
});

describe('memoryCleanupHandler', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    setCronPrismaClient(prisma);
  });

  it('calls deleteMany twice (expired + low-confidence)', async () => {
    await expect(memoryCleanupHandler(makeCtx())).resolves.toBeUndefined();
    expect(prisma.memory.deleteMany).toHaveBeenCalledTimes(2);
  });
});

describe('healthReportHandler', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    setCronPrismaClient(prisma);
  });

  it('pings db and counts records', async () => {
    await expect(healthReportHandler(makeCtx())).resolves.toBeUndefined();
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.project.count).toHaveBeenCalledOnce();
    expect(prisma.task.count).toHaveBeenCalledOnce();
    expect(prisma.memory.count).toHaveBeenCalledOnce();
  });
});

describe('budgetResetHandler', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    setCronPrismaClient(prisma);
  });

  it('resets agent spending', async () => {
    await expect(budgetResetHandler(makeCtx())).resolves.toBeUndefined();
    expect(prisma.agent.updateMany).toHaveBeenCalledOnce();
    expect(prisma.agent.updateMany).toHaveBeenCalledWith({
      where: { spentMonthlyCents: { gt: 0 } },
      data: { spentMonthlyCents: 0 },
    });
  });
});

describe('getDefaultHandlers', () => {
  it('returns exactly 6 handlers', () => {
    const handlers = getDefaultHandlers();
    expect(Object.keys(handlers)).toHaveLength(6);
  });

  it('includes all expected handler keys', () => {
    const handlers = getDefaultHandlers();
    expect(handlers).toHaveProperty('morning-brief');
    expect(handlers).toHaveProperty('email-digest');
    expect(handlers).toHaveProperty('memory-cleanup');
    expect(handlers).toHaveProperty('health-report');
    expect(handlers).toHaveProperty('budget-reset');
    expect(handlers).toHaveProperty('agent-heartbeat');
  });

  it('all values are functions', () => {
    const handlers = getDefaultHandlers();
    for (const fn of Object.values(handlers)) {
      expect(typeof fn).toBe('function');
    }
  });
});

describe('agentHeartbeatHandler', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    setCronPrismaClient(prisma);
    setHeartbeatRunner(null);
  });

  afterEach(() => {
    setHeartbeatRunner(null);
  });

  it('does not throw when scheduler module is missing (no injection)', async () => {
    // No runner injected and the lib module won't be available in test env.
    await expect(agentHeartbeatHandler(makeCtx())).resolves.toBeUndefined();
  });

  it('calls the injected runner with prisma and config derived from payload', async () => {
    const runner = vi.fn().mockResolvedValue({});
    setHeartbeatRunner(runner);

    await agentHeartbeatHandler(makeCtx({ gatewayPort: 4000, batchSize: 10 }));

    expect(runner).toHaveBeenCalledOnce();
    const [deps, config] = runner.mock.calls[0];
    expect(deps.prisma).toBe(prisma);
    expect(config.gatewayPort).toBe(4000);
    expect(config.batchSize).toBe(10);
  });

  it('falls back to PYRFOR_GATEWAY_PORT env var when payload has no gatewayPort', async () => {
    const runner = vi.fn().mockResolvedValue({});
    setHeartbeatRunner(runner);
    process.env.PYRFOR_GATEWAY_PORT = '5001';

    try {
      await agentHeartbeatHandler(makeCtx());
      const [, config] = runner.mock.calls[0];
      expect(config.gatewayPort).toBe(5001);
    } finally {
      delete process.env.PYRFOR_GATEWAY_PORT;
    }
  });

  it('falls back to port 3000 when neither payload nor env var is set', async () => {
    const runner = vi.fn().mockResolvedValue({});
    setHeartbeatRunner(runner);
    delete process.env.PYRFOR_GATEWAY_PORT;

    await agentHeartbeatHandler(makeCtx());
    const [, config] = runner.mock.calls[0];
    expect(config.gatewayPort).toBe(3000);
  });

  it('propagates rejection from injected runner', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('heartbeat failed'));
    setHeartbeatRunner(runner);
    await expect(agentHeartbeatHandler(makeCtx())).rejects.toThrow('heartbeat failed');
  });
});

// ─── Error paths: Prisma not initialized ──────────────────────────────────────

describe('error path: Prisma not initialized', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setCronPrismaClient(null as any);
  });

  afterEach(() => {
    setCronPrismaClient(makePrisma());
  });

  it('morningBriefHandler throws when Prisma not set', async () => {
    await expect(morningBriefHandler(makeCtx({ chatIds: [1] }))).rejects.toThrow(
      /Prisma client not initialised/,
    );
  });

  it('emailDigestHandler throws when Prisma not set', async () => {
    await expect(emailDigestHandler(makeCtx())).rejects.toThrow(/Prisma client not initialised/);
  });

  it('memoryCleanupHandler throws when Prisma not set', async () => {
    await expect(memoryCleanupHandler(makeCtx())).rejects.toThrow(/Prisma client not initialised/);
  });

  it('healthReportHandler throws when Prisma not set', async () => {
    await expect(healthReportHandler(makeCtx())).rejects.toThrow(/Prisma client not initialised/);
  });

  it('budgetResetHandler throws when Prisma not set', async () => {
    await expect(budgetResetHandler(makeCtx())).rejects.toThrow(/Prisma client not initialised/);
  });
});

// ─── Error paths: Prisma query rejects ────────────────────────────────────────

describe('error path: Prisma query rejects', () => {
  it('morningBriefHandler propagates findMany rejection', async () => {
    const prisma = makePrisma();
    prisma.project.findMany.mockRejectedValueOnce(new Error('db error'));
    setCronPrismaClient(prisma);
    await expect(morningBriefHandler(makeCtx({ chatIds: [1] }))).rejects.toThrow('db error');
  });

  it('emailDigestHandler propagates task.count rejection', async () => {
    const prisma = makePrisma();
    prisma.task.count.mockRejectedValueOnce(new Error('db error'));
    setCronPrismaClient(prisma);
    await expect(emailDigestHandler(makeCtx())).rejects.toThrow('db error');
  });

  it('memoryCleanupHandler propagates deleteMany rejection', async () => {
    const prisma = makePrisma();
    prisma.memory.deleteMany.mockRejectedValueOnce(new Error('cleanup fail'));
    setCronPrismaClient(prisma);
    await expect(memoryCleanupHandler(makeCtx())).rejects.toThrow('cleanup fail');
  });

  it('healthReportHandler propagates $queryRaw rejection', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockRejectedValueOnce(new Error('db unreachable'));
    setCronPrismaClient(prisma);
    await expect(healthReportHandler(makeCtx())).rejects.toThrow('db unreachable');
  });

  it('budgetResetHandler propagates updateMany rejection', async () => {
    const prisma = makePrisma();
    prisma.agent.updateMany.mockRejectedValueOnce(new Error('update fail'));
    setCronPrismaClient(prisma);
    await expect(budgetResetHandler(makeCtx())).rejects.toThrow('update fail');
  });
});

// ─── morningBriefHandler: no payload ──────────────────────────────────────────

describe('morningBriefHandler: no payload', () => {
  it('returns early without querying Prisma when payload is undefined', async () => {
    const prisma = makePrisma();
    setCronPrismaClient(prisma);
    await expect(morningBriefHandler(makeCtx(undefined))).resolves.toBeUndefined();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });
});

// ─── CronService integration: handler error does not crash service ─────────────

describe('CronService integration: handler error does not crash service', () => {
  let svc: CronService;

  beforeEach(() => {
    svc = new CronService();
  });

  afterEach(() => {
    svc.stop();
    setCronPrismaClient(makePrisma());
  });

  it('failureCount increments when morningBriefHandler throws, service stays running', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setCronPrismaClient(null as any);

    svc.registerHandler('morning-brief', morningBriefHandler);
    svc.start([{ name: 'brief', schedule: '* * * * *', handler: 'morning-brief', payload: { chatIds: [1] } }]);

    await expect(svc.triggerJob('brief')).rejects.toThrow(/Prisma client not initialised/);

    expect(svc.isRunning()).toBe(true);
    const st = svc.getStatus().find(s => s.name === 'brief')!;
    expect(st.failureCount).toBe(1);
    expect(st.lastError).toMatch(/Prisma client not initialised/);
  });

  it('failureCount increments when emailDigestHandler throws, service stays running', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setCronPrismaClient(null as any);

    svc.registerHandler('email-digest', emailDigestHandler);
    svc.start([{ name: 'digest', schedule: '* * * * *', handler: 'email-digest' }]);

    await expect(svc.triggerJob('digest')).rejects.toThrow(/Prisma client not initialised/);

    expect(svc.isRunning()).toBe(true);
    const st = svc.getStatus().find(s => s.name === 'digest')!;
    expect(st.failureCount).toBe(1);
  });
});

// ─── morningBriefHandler: no projects in DB ──────────────────────────────────

describe('morningBriefHandler: no projects in DB', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    prisma.project.findMany.mockResolvedValue([]); // empty result set
    prisma.task.count.mockResolvedValue(0);
    setCronPrismaClient(prisma);
  });

  it('resolves without throwing when DB returns an empty project list', async () => {
    await expect(morningBriefHandler(makeCtx({ chatIds: [1] }))).resolves.toBeUndefined();
  });

  it('still queries tasks even when no projects are found (sensible empty digest)', async () => {
    await morningBriefHandler(makeCtx({ chatIds: [42] }));
    expect(prisma.project.findMany).toHaveBeenCalledOnce();
    // overdue + upcoming task counts are still fetched
    expect(prisma.task.count).toHaveBeenCalledTimes(2);
  });
});

// ─── agentHeartbeatHandler: degraded subagent ────────────────────────────────

describe('agentHeartbeatHandler: degraded subagent', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    setCronPrismaClient(prisma);
  });

  afterEach(() => {
    setHeartbeatRunner(null);
  });

  it('resolves normally when the runner reports degraded agents in its result', async () => {
    const degradedResult = {
      processed: 3,
      agents: [
        { id: 'a1', status: 'degraded', lastError: 'connection timeout' },
        { id: 'a2', status: 'healthy' },
        { id: 'a3', status: 'degraded', lastError: 'OOM' },
      ],
    };
    const runner = vi.fn().mockResolvedValue(degradedResult);
    setHeartbeatRunner(runner);

    // Handler should not throw — degraded status is informational
    await expect(agentHeartbeatHandler(makeCtx())).resolves.toBeUndefined();
    expect(runner).toHaveBeenCalledOnce();
  });

  it('propagates runner error when all agents are unreachable (gateway degradation)', async () => {
    const runner = vi.fn().mockRejectedValue(
      new Error('all 5 agents unreachable — possible gateway degradation'),
    );
    setHeartbeatRunner(runner);

    await expect(agentHeartbeatHandler(makeCtx())).rejects.toThrow('unreachable');
  });
});

// ─── built-in handler name properties ────────────────────────────────────────

describe('built-in handler name properties', () => {
  it('each handler function has a non-empty .name property (not anonymous)', () => {
    const handlers = getDefaultHandlers();
    for (const fn of Object.values(handlers)) {
      expect(typeof fn.name).toBe('string');
      expect(fn.name.length).toBeGreaterThan(0);
    }
  });

  it('handler .name properties match the exported variable names', () => {
    const handlers = getDefaultHandlers();
    // Each function's JS .name corresponds to the const it was assigned to,
    // making it easy to identify handlers in stack traces and logs.
    const expectedNames: Record<string, string> = {
      'morning-brief': 'morningBriefHandler',
      'email-digest': 'emailDigestHandler',
      'memory-cleanup': 'memoryCleanupHandler',
      'health-report': 'healthReportHandler',
      'budget-reset': 'budgetResetHandler',
      'agent-heartbeat': 'agentHeartbeatHandler',
    };
    for (const [key, fn] of Object.entries(handlers)) {
      expect(fn.name).toBe(expectedNames[key]);
    }
  });
});

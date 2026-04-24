import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setCronPrismaClient,
  getCronPrismaClient,
  morningBriefHandler,
  emailDigestHandler,
  memoryCleanupHandler,
  healthReportHandler,
  budgetResetHandler,
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
  it('returns exactly 5 handlers', () => {
    const handlers = getDefaultHandlers();
    expect(Object.keys(handlers)).toHaveLength(5);
  });

  it('includes all expected handler keys', () => {
    const handlers = getDefaultHandlers();
    expect(handlers).toHaveProperty('morning-brief');
    expect(handlers).toHaveProperty('email-digest');
    expect(handlers).toHaveProperty('memory-cleanup');
    expect(handlers).toHaveProperty('health-report');
    expect(handlers).toHaveProperty('budget-reset');
  });

  it('does NOT include agent-heartbeat', () => {
    const handlers = getDefaultHandlers();
    expect(handlers).not.toHaveProperty('agent-heartbeat');
  });

  it('all values are functions', () => {
    const handlers = getDefaultHandlers();
    for (const fn of Object.values(handlers)) {
      expect(typeof fn).toBe('function');
    }
  });
});

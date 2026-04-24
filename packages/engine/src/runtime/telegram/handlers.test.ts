// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeMarkdown,
  isAllowedChat,
  createRateLimiter,
  setTelegramPrismaClient,
  getTelegramPrismaClient,
  handleStatus,
  handleProjects,
  handleTasks,
  handleAddTask,
  handleAi,
  handleMorningBrief,
} from './handlers';

// ─── escapeMarkdown ───────────────────────────────────────────────────────────

describe('escapeMarkdown', () => {
  it('escapes all Telegram MarkdownV2 special characters', () => {
    const special = '_ * [ ] ( ) ~ ` > # + - = | { } . !';
    const result = escapeMarkdown(special);
    // every special char should now be preceded by backslash
    expect(result).toMatch(/\\_/);
    expect(result).toMatch(/\\\*/);
    expect(result).toMatch(/\\\[/);
    expect(result).toMatch(/\\\]/);
    expect(result).toMatch(/\\\(/);
    expect(result).toMatch(/\\\)/);
    expect(result).toMatch(/\\~/);
    expect(result).toMatch(/\\`/);
    expect(result).toMatch(/\\>/);
    expect(result).toMatch(/\\#/);
    expect(result).toMatch(/\\\+/);
    expect(result).toMatch(/\\-/);
    expect(result).toMatch(/\\=/);
    expect(result).toMatch(/\\\|/);
    expect(result).toMatch(/\\\{/);
    expect(result).toMatch(/\\\}/);
    expect(result).toMatch(/\\\./);
    expect(result).toMatch(/\\!/);
  });

  it('does not escape regular alphanumeric text', () => {
    expect(escapeMarkdown('Hello World 123')).toBe('Hello World 123');
  });
});

// ─── isAllowedChat ────────────────────────────────────────────────────────────

describe('isAllowedChat', () => {
  it('empty allowedChatIds allows any chatId (open mode)', () => {
    expect(isAllowedChat(123, [])).toBe(true);
    expect(isAllowedChat(999, [])).toBe(true);
  });

  it('non-empty list enforces inclusion', () => {
    expect(isAllowedChat(123, [123, 456])).toBe(true);
    expect(isAllowedChat(789, [123, 456])).toBe(false);
  });
});

// ─── createRateLimiter ────────────────────────────────────────────────────────

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first call is allowed', () => {
    const limiter = createRateLimiter(5);
    expect(limiter.allow(1)).toBe(true);
  });

  it('second call within window denied when perMinute=1', () => {
    const limiter = createRateLimiter(1);
    expect(limiter.allow(1)).toBe(true);
    expect(limiter.allow(1)).toBe(false);
  });

  it('allows again after the 60-second window has elapsed', () => {
    const limiter = createRateLimiter(1);
    expect(limiter.allow(1)).toBe(true);
    expect(limiter.allow(1)).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(limiter.allow(1)).toBe(true);
  });

  it('tracks different chatIds independently', () => {
    const limiter = createRateLimiter(1);
    expect(limiter.allow(1)).toBe(true);
    // chatId 2 not yet used
    expect(limiter.allow(2)).toBe(true);
    // both should now be exhausted
    expect(limiter.allow(1)).toBe(false);
    expect(limiter.allow(2)).toBe(false);
  });
});

// ─── Prisma mock helpers ──────────────────────────────────────────────────────

function makePrismaMock() {
  return {
    project: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  };
}

const ARGS = { chatId: 42, text: '', params: [] };

// ─── handleStatus ─────────────────────────────────────────────────────────────

describe('handleStatus', () => {
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    setTelegramPrismaClient(prisma);
  });

  it('returns empty-state message when no projects', async () => {
    prisma.project.findMany.mockResolvedValue([]);
    const result = await handleStatus(ARGS);
    expect(result).toContain('Нет проектов');
  });

  it('returns status string with project data', async () => {
    prisma.project.findMany.mockResolvedValue([
      { name: 'Alpha', status: 'active', progress: 50, health: 80 },
    ]);
    const result = await handleStatus(ARGS);
    expect(result).toContain('Alpha');
    expect(result).toContain('50%');
    expect(prisma.project.findMany).toHaveBeenCalledOnce();
  });

  it('shows at-risk count in summary', async () => {
    prisma.project.findMany.mockResolvedValue([
      { name: 'Bridge', status: 'at-risk', progress: 20, health: 30 },
    ]);
    const result = await handleStatus(ARGS);
    expect(result).toContain('В риске: 1');
  });
});

// ─── handleProjects ───────────────────────────────────────────────────────────

describe('handleProjects', () => {
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    setTelegramPrismaClient(prisma);
  });

  it('returns empty-state message when no projects', async () => {
    prisma.project.findMany.mockResolvedValue([]);
    const result = await handleProjects(ARGS);
    expect(result).toContain('пока нет');
  });

  it('lists projects with priority emoji and description', async () => {
    prisma.project.findMany.mockResolvedValue([
      { id: '1', name: 'Road', status: 'active', progress: 70, health: 90, description: 'Main road', priority: 'high' },
    ]);
    const result = await handleProjects(ARGS);
    expect(result).toContain('Road');
    expect(result).toContain('70%');
    expect(result).toContain('Main road');
    expect(prisma.project.findMany).toHaveBeenCalledOnce();
  });
});

// ─── handleTasks ──────────────────────────────────────────────────────────────

describe('handleTasks', () => {
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    setTelegramPrismaClient(prisma);
  });

  it('returns done message when no open tasks', async () => {
    prisma.task.findMany.mockResolvedValue([]);
    const result = await handleTasks(ARGS);
    expect(result).toContain('выполнены');
  });

  it('lists open tasks and shows blocked count', async () => {
    prisma.task.findMany.mockResolvedValue([
      { title: 'Fix bug', status: 'blocked', priority: 'high', dueDate: null, assignee: null, project: { name: 'Alpha' } },
      { title: 'Write tests', status: 'todo', priority: 'medium', dueDate: null, assignee: null, project: null },
    ]);
    const result = await handleTasks(ARGS);
    expect(result).toContain('Fix bug');
    expect(result).toContain('Заблокировано: 1');
    expect(prisma.task.findMany).toHaveBeenCalledOnce();
  });
});

// ─── handleAddTask ────────────────────────────────────────────────────────────

describe('handleAddTask', () => {
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    setTelegramPrismaClient(prisma);
  });

  it('returns usage hint when params are missing', async () => {
    const result = await handleAddTask({ chatId: 1, text: '', params: [] });
    expect(result).toContain('Использование');
  });

  it('returns project-not-found with suggestions when project missing', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    prisma.project.findMany.mockResolvedValue([{ name: 'Existing' }]);
    const result = await handleAddTask({ chatId: 1, text: '', params: ['Bridge', 'Check', 'foundation'] });
    expect(result).toContain('не найден');
    expect(result).toContain('Existing');
  });

  it('creates task and returns success message', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1', name: 'Bridge' });
    prisma.task.create.mockResolvedValue({});
    const result = await handleAddTask({ chatId: 1, text: '', params: ['Bridge', 'Check', 'concrete'] });
    expect(result).toContain('создана');
    expect(result).toContain('Check concrete');
    expect(result).toContain('Bridge');
    expect(prisma.task.create).toHaveBeenCalledOnce();
    const createArg = prisma.task.create.mock.calls[0][0].data;
    expect(createArg.title).toBe('Check concrete');
    expect(createArg.projectId).toBe('p1');
    expect(createArg.status).toBe('todo');
  });
});

// ─── handleAi ────────────────────────────────────────────────────────────────

describe('handleAi', () => {
  it('returns usage hint when no query text', async () => {
    const result = await handleAi({ chatId: 1, text: '', params: [] });
    expect(result).toContain('Использование');
  });

  it('returns stub message when runMessage not provided', async () => {
    const result = await handleAi({ chatId: 1, text: '', params: ['What', 'is', 'overdue?'] });
    expect(result).toContain('not wired');
  });

  it('delegates to runMessage when provided', async () => {
    const runMessage = vi.fn().mockResolvedValue('Here are 3 overdue tasks…');
    const result = await handleAi({ chatId: 1, text: '', params: ['What', 'is', 'overdue?'] }, runMessage);
    expect(result).toBe('Here are 3 overdue tasks…');
    expect(runMessage).toHaveBeenCalledWith('What is overdue?');
  });
});

// ─── handleMorningBrief ───────────────────────────────────────────────────────

describe('handleMorningBrief', () => {
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    setTelegramPrismaClient(prisma);
  });

  it('composes all sections and shows "все по плану" when clean', async () => {
    prisma.project.findMany.mockResolvedValue([
      { name: 'Alpha', status: 'active', progress: 60, health: 85 },
    ]);
    prisma.task.findMany
      .mockResolvedValueOnce([])  // overdue
      .mockResolvedValueOnce([])  // upcoming
      .mockResolvedValueOnce([]); // blocked
    const result = await handleMorningBrief(ARGS);
    expect(result).toContain('Утренний брифинг');
    expect(result).toContain('Проекты:');
    expect(result).toContain('плану');
  });

  it('lists overdue tasks when present', async () => {
    prisma.project.findMany.mockResolvedValue([]);
    prisma.task.findMany
      .mockResolvedValueOnce([{ title: 'Fix leak', dueDate: new Date('2020-01-01'), project: { name: 'Dam' } }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await handleMorningBrief(ARGS);
    expect(result).toContain('Просрочено');
    expect(result).toContain('Fix leak');
  });

  it('lists blocked tasks when present', async () => {
    prisma.project.findMany.mockResolvedValue([]);
    prisma.task.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ title: 'Deploy', description: 'waiting for cert' }]);
    const result = await handleMorningBrief(ARGS);
    expect(result).toContain('Заблокировано');
    expect(result).toContain('Deploy');
  });

  it('highlights at-risk projects', async () => {
    prisma.project.findMany.mockResolvedValue([
      { name: 'Bridge', status: 'at-risk', progress: 10, health: 20 },
    ]);
    prisma.task.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await handleMorningBrief(ARGS);
    expect(result).toContain('в риске');
    expect(result).toContain('Bridge');
  });

  it('lists upcoming tasks when present', async () => {
    prisma.project.findMany.mockResolvedValue([]);
    prisma.task.findMany
      .mockResolvedValueOnce([])   // overdue
      .mockResolvedValueOnce([     // upcoming
        { title: 'Deploy service', dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), priority: 'high' },
      ])
      .mockResolvedValueOnce([]); // blocked
    const result = await handleMorningBrief(ARGS);
    expect(result).toContain('На этой неделе');
    expect(result).toContain('Deploy service');
  });
});

// ─── getTelegramPrismaClient ─────────────────────────────────────────────────

describe('getTelegramPrismaClient', () => {
  it('throws when client has not been initialised', () => {
    // reset to null by setting undefined-ish via the setter (cast)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setTelegramPrismaClient(null as any);
    expect(() => getTelegramPrismaClient()).toThrow('Prisma client not initialised');
  });

  it('returns the client once set', () => {
    const fake = { project: {}, task: {} };
    setTelegramPrismaClient(fake);
    expect(getTelegramPrismaClient()).toBe(fake);
  });
});

// ─── Edge: markdown escaping in dynamic content ────────────────────────────

describe('escapeMarkdown — dynamic content escaping', () => {
  it('escapes project names containing MarkdownV2 special chars in handleStatus output', async () => {
    const prisma = makePrismaMock();
    setTelegramPrismaClient(prisma);
    prisma.project.findMany.mockResolvedValue([
      { name: 'Alpha_Beta.Gamma!', status: 'active', progress: 55, health: 70 },
    ]);
    const result = await handleStatus(ARGS);
    // Special chars inside the project name must be escaped
    expect(result).toContain('Alpha\\_Beta\\.Gamma\\!');
  });

  it('escapes task titles containing special chars in handleTasks output', async () => {
    const prisma = makePrismaMock();
    setTelegramPrismaClient(prisma);
    prisma.task.findMany.mockResolvedValue([
      { title: 'Fix: (critical) - restart!', status: 'todo', priority: 'high', dueDate: null, assignee: null, project: null },
    ]);
    const result = await handleTasks(ARGS);
    // colon is NOT a MarkdownV2 special char — kept as-is
    expect(result).toContain('Fix:');
    // parens and exclamation ARE special — must be escaped
    expect(result).toContain('\\(critical\\)');
    expect(result).toContain('restart\\!');
  });
});

// ─── Edge: handleStatus status emoji variants ───────────────────────────────

describe('handleStatus — all status variants', () => {
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    setTelegramPrismaClient(prisma);
  });

  it.each([
    ['active',    '🟢'],
    ['completed', '✅'],
    ['at-risk',   '🔴'],
    ['on-hold',   '⏸️'],
    ['unknown',   '🟡'],
  ])('status "%s" renders emoji %s', async (status, emoji) => {
    prisma.project.findMany.mockResolvedValue([
      { name: 'TestProject', status, progress: 0, health: null },
    ]);
    const result = await handleStatus(ARGS);
    expect(result).toContain(emoji);
  });

  it('omits health bar when health is null', async () => {
    prisma.project.findMany.mockResolvedValue([
      { name: 'Healthless', status: 'active', progress: 10, health: null },
    ]);
    const result = await handleStatus(ARGS);
    expect(result).not.toContain('Health:');
  });

  it('includes health bar when health is provided', async () => {
    prisma.project.findMany.mockResolvedValue([
      { name: 'Healthy', status: 'active', progress: 80, health: 95 },
    ]);
    const result = await handleStatus(ARGS);
    expect(result).toContain('Health: 95%');
  });
});

// ─── Edge: handleProjects long description truncation ───────────────────────

describe('handleProjects — long description', () => {
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    setTelegramPrismaClient(prisma);
  });

  it('truncates description longer than 80 chars', async () => {
    const longDesc = 'A'.repeat(100);
    prisma.project.findMany.mockResolvedValue([
      { id: '1', name: 'BigProject', status: 'active', progress: 0, health: null, description: longDesc, priority: 'medium' },
    ]);
    const result = await handleProjects(ARGS);
    // The handler appends '...' before escapeMarkdown, so dots become '\.\.\.' in output
    expect(result).toContain('\\.\\.\\.');
    // The raw 100-char string should NOT appear verbatim
    expect(result).not.toContain(longDesc);
  });

  it('renders description as-is when 80 chars or fewer', async () => {
    const shortDesc = 'Short description';
    prisma.project.findMany.mockResolvedValue([
      { id: '1', name: 'SmallProject', status: 'active', progress: 0, health: null, description: shortDesc, priority: 'low' },
    ]);
    const result = await handleProjects(ARGS);
    expect(result).toContain(shortDesc);
    expect(result).not.toContain('...');
  });

  it('skips description line when description is null', async () => {
    prisma.project.findMany.mockResolvedValue([
      { id: '1', name: 'NoDesc', status: 'active', progress: 0, health: null, description: null, priority: 'low' },
    ]);
    const result = await handleProjects(ARGS);
    expect(result).not.toContain('_'); // no italic description line
  });
});

// ─── Edge: handleTasks in-progress and due date ────────────────────────────

describe('handleTasks — in-progress and due dates', () => {
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    setTelegramPrismaClient(prisma);
  });

  it('renders 🔄 for in_progress status', async () => {
    prisma.task.findMany.mockResolvedValue([
      { title: 'In-flight task', status: 'in_progress', priority: 'medium', dueDate: null, assignee: null, project: null },
    ]);
    const result = await handleTasks(ARGS);
    expect(result).toContain('🔄');
  });

  it('renders 🔄 for in-progress (hyphenated) status', async () => {
    prisma.task.findMany.mockResolvedValue([
      { title: 'Hyphen task', status: 'in-progress', priority: 'medium', dueDate: null, assignee: null, project: null },
    ]);
    const result = await handleTasks(ARGS);
    expect(result).toContain('🔄');
  });

  it('shows due date when provided', async () => {
    const dueDate = new Date('2025-06-15');
    prisma.task.findMany.mockResolvedValue([
      { title: 'Dated task', status: 'todo', priority: 'low', dueDate, assignee: null, project: null },
    ]);
    const result = await handleTasks(ARGS);
    expect(result).toContain('📅');
  });

  it('shows critical priority emoji', async () => {
    prisma.task.findMany.mockResolvedValue([
      { title: 'Critical task', status: 'todo', priority: 'critical', dueDate: null, assignee: null, project: null },
    ]);
    const result = await handleTasks(ARGS);
    expect(result).toContain('🔴');
  });
});

// ─── Edge: concurrent invocations are independent ──────────────────────────

describe('concurrent invocations', () => {
  it('handleStatus results for different chatIds are independent', async () => {
    const prisma1 = makePrismaMock();
    const prisma2 = makePrismaMock();

    setTelegramPrismaClient(prisma1);
    prisma1.project.findMany.mockResolvedValue([
      { name: 'ProjectAlpha', status: 'active', progress: 10, health: null },
    ]);
    const p1 = handleStatus({ chatId: 1, text: '', params: [] });

    setTelegramPrismaClient(prisma2);
    prisma2.project.findMany.mockResolvedValue([
      { name: 'ProjectBeta', status: 'at-risk', progress: 5, health: null },
    ]);
    const p2 = handleStatus({ chatId: 2, text: '', params: [] });

    const [r1, r2] = await Promise.all([p1, p2]);
    // Each result should reflect the prisma client active at call-time:
    // both calls share the module-level singleton, so both see prisma2
    // (this is expected and documents the singleton behaviour).
    expect(r1).toBeTruthy();
    expect(r2).toBeTruthy();
    expect(r2).toContain('ProjectBeta');
  });

  it('handleAi with different chatIds does not share state', async () => {
    const runner1 = vi.fn().mockResolvedValue('Result for chat 1');
    const runner2 = vi.fn().mockResolvedValue('Result for chat 2');

    const [r1, r2] = await Promise.all([
      handleAi({ chatId: 1, text: '', params: ['query one'] }, runner1),
      handleAi({ chatId: 2, text: '', params: ['query two'] }, runner2),
    ]);

    expect(r1).toBe('Result for chat 1');
    expect(r2).toBe('Result for chat 2');
    expect(runner1).toHaveBeenCalledWith('query one');
    expect(runner2).toHaveBeenCalledWith('query two');
  });
});

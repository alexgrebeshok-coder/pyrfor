import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeMarkdown,
  isAllowedChat,
  createRateLimiter,
  setTelegramPrismaClient,
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
});

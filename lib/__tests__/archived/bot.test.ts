import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Telegram Bot Tests
 *
 * Тесты для команд Telegram бота CEOClaw
 */

// Mock Prisma
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    project: {
      findMany: vi.fn(() => [
        { id: '1', name: 'ЧЭМК', status: 'active', priority: 'high', direction: 'metallurgy' },
        { id: '2', name: 'Бентонит', status: 'planning', priority: 'critical', direction: 'logistics' },
      ]),
      findFirst: vi.fn(() => ({ id: '1', name: 'ЧЭМК' })),
    },
    task: {
      findMany: vi.fn(() => [
        { id: '1', title: 'Согласовать СП', status: 'in_progress', priority: 'high' },
        { id: '2', title: 'Подготовить КП', status: 'todo', priority: 'medium' },
      ]),
      create: vi.fn(() => ({ id: '3', title: 'Новая задача', status: 'todo' })),
    },
  })),
}));

// Mock Telegram Bot
vi.mock('node-telegram-bot-api', () => {
  return vi.fn(() => ({
    sendMessage: vi.fn(),
    onText: vi.fn(),
  }));
});

describe('Telegram Bot Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('/start command', () => {
    it('should send welcome message', async () => {
      const { handleStart } = await import('@/lib/telegram/commands/start');
      const mockBot = { sendMessage: vi.fn() };
      const chatId = 123456;

      await handleStart(mockBot as any, chatId);

      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Добро пожаловать')
      );
    });
  });

  describe('/help command', () => {
    it('should send help message', async () => {
      const { handleHelp } = await import('@/lib/telegram/commands/help');
      const mockBot = { sendMessage: vi.fn() };
      const chatId = 123456;

      await handleHelp(mockBot as any, chatId);

      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('/status')
      );
    });
  });

  describe('/status command', () => {
    it('should return project status list', async () => {
      const { handleStatus } = await import('@/lib/telegram/commands/status');
      const mockBot = { sendMessage: vi.fn() };
      const chatId = 123456;

      await handleStatus(mockBot as any, chatId);

      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Статус проектов')
      );
    });
  });

  describe('/projects command', () => {
    it('should return project list', async () => {
      const { handleProjects } = await import('@/lib/telegram/commands/projects');
      const mockBot = { sendMessage: vi.fn() };
      const chatId = 123456;

      await handleProjects(mockBot as any, chatId);

      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Список проектов')
      );
    });
  });

  describe('/tasks command', () => {
    it('should return task list', async () => {
      const { handleTasks } = await import('@/lib/telegram/commands/tasks');
      const mockBot = { sendMessage: vi.fn() };
      const chatId = 123456;

      await handleTasks(mockBot as any, chatId);

      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Список задач')
      );
    });
  });

  describe('/add_task command', () => {
    it('should create new task', async () => {
      const { handleAddTask } = await import('@/lib/telegram/commands/add-task');
      const mockBot = { sendMessage: vi.fn() };
      const chatId = 123456;
      const match = ['/add_task ЧЭМК Тестовая задача', 'ЧЭМК Тестовая задача'];

      await handleAddTask(mockBot as any, chatId, match);

      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('создана')
      );
    });
  });
});

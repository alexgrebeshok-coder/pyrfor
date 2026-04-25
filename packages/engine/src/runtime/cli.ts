#!/usr/bin/env node
/**
 * Pyrfor Runtime CLI — Entry point
 *
 * Usage:
 *   node dist/runtime/cli.js              # Start runtime
 *   node dist/runtime/cli.js --chat       # Interactive CLI mode
 *   node dist/runtime/cli.js --telegram   # Telegram bot mode
 *   node dist/runtime/cli.js --once "question"  # One-shot question
 */

import { createInterface } from 'readline';
import { homedir } from 'os';
import { access as fsAccess } from 'node:fs/promises';
import path from 'path';
import { PyrforRuntime } from './index';
import { logger } from '../observability/logger';
import { loadConfig, DEFAULT_CONFIG_PATH } from './config';
import { createServiceManager } from './service';
import { transcribeTelegramVoice } from './voice';
import { discoverLegacyStores, migrateLegacyStore } from './migrate-sessions';
import { exportTrajectoriesToFile, type ExportOptions } from './export-cli';
import {
  isAllowedChat,
  createRateLimiter,
  handleStatus,
  handleProjects,
  handleTasks,
  handleAddTask,
  handleAi,
  handleMorningBrief,
} from './telegram/handlers';
import { approvalFlow } from './approval-flow';
import { LiveActivity } from './telegram/live-activity';
import { GoalStore } from './goal-store';
import type { ProgressEvent } from './tool-loop';
import { mkdirSync, writeFileSync as writeFS } from 'fs';

// ============================================
// Defaults
// ============================================

/** Default workspace path: ~/.openclaw/workspace (SOUL.md/IDENTITY.md/MEMORY.md). */
const DEFAULT_WORKSPACE_PATH = path.join(homedir(), '.openclaw', 'workspace');

// ============================================
// CLI Types
// ============================================

type CLIMode = 'daemon' | 'chat' | 'telegram' | 'once';

interface CLIOptions {
  mode: CLIMode;
  message?: string;
  workspacePath?: string;
  provider?: string;
  model?: string;
  /** Path to runtime.json config (default: ~/.pyrfor/runtime.json) */
  configPath?: string;
  help: boolean;
}

// ============================================
// Argument Parser
// ============================================

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);

  const options: CLIOptions = {
    mode: 'daemon',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;

      case '--chat':
        options.mode = 'chat';
        break;

      case '--telegram':
        options.mode = 'telegram';
        break;

      case '--once':
        options.mode = 'once';
        options.message = args[++i];
        break;

      case '--workspace':
      case '-w':
        options.workspacePath = args[++i];
        break;

      case '--provider':
      case '-p':
        options.provider = args[++i];
        break;

      case '--model':
      case '-m':
        options.model = args[++i];
        break;

      case '--config':
      case '-c':
        options.configPath = args[++i];
        break;
    }
  }

  return options;
}

function showHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
Pyrfor Runtime — Standalone AI Assistant Engine

Usage:
  pyrfor-runtime [options]
  pyrfor-runtime service <subcommand> [options]

Options:
  --chat              Interactive CLI mode
  --telegram          Telegram bot mode
  --once "question"   One-shot question and exit
  --workspace, -w     Workspace path (default: ~/.openclaw/workspace)
  --config, -c        Path to runtime.json config (default: ~/.pyrfor/runtime.json)
  --provider, -p      Default AI provider (zai, openrouter, ollama)
  --model, -m         Model to use
  --help, -h          Show this help

Service Commands:
  service install     Install as OS service (LaunchAgent on macOS, systemd user unit on Linux)
  service uninstall   Remove OS service and disable autostart
  service status      Print service status as JSON

  Install options:
    --env-file <path>   Path to .env file (default: .env in cwd if it exists)
    --exec <path>       Path to executable (default: current node process)
    --workdir <dir>     Working directory (default: cwd)

Environment Variables:
  ZAI_API_KEY         API key for ZAI provider
  OPENROUTER_API_KEY  API key for OpenRouter
  OPENAI_API_KEY      API key for OpenAI
  TELEGRAM_BOT_TOKEN  Bot token for Telegram mode
  OLLAMA_URL          URL for Ollama (default: http://localhost:11434)
  LOG_LEVEL           Set to debug, info, warn, error, or silent

Examples:
  # Interactive chat
  npm run cli -- --chat

  # One-shot question
  npm run cli -- --once "What is TypeScript?"

  # Telegram bot
  npm run cli -- --telegram

  # Install as system service
  pyrfor-runtime service install --env-file /path/to/.env

  # Check service status
  pyrfor-runtime service status
`);
}

// ============================================
// Mode Handlers
// ============================================

/**
 * Daemon mode — just start and keep running
 */
async function runDaemon(runtime: PyrforRuntime): Promise<void> {
  logger.info('Running in daemon mode');

  // Runtime is already started, just keep alive
  // Could add health check server here

  // Keep process alive
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await runtime.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    await runtime.stop();
    process.exit(0);
  });

  // Keep running indefinitely
  return new Promise(() => {
    setInterval(() => {
      const stats = runtime.getStats();
      logger.debug('Heartbeat', {
        sessions: stats.sessions.active,
        tokens: stats.sessions.totalTokens,
      });
    }, 60000); // Log stats every minute
  });
}

/**
 * Interactive chat mode
 */
async function runChat(runtime: PyrforRuntime, options: CLIOptions): Promise<void> {
  logger.info('Running in interactive chat mode');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const userId = 'cli-user';
  const chatId = 'cli-chat';

  // eslint-disable-next-line no-console
  console.log('\n🤖 Pyrfor Runtime — Interactive Mode');
  // eslint-disable-next-line no-console
  console.log('Type your message or "exit" to quit.\n');

  const askQuestion = (): void => {
    rl.question('You: ', async (input) => {
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        rl.close();
        await runtime.stop();
        process.exit(0);
      }

      if (input.toLowerCase() === 'stats') {
        const stats = runtime.getStats();
        // eslint-disable-next-line no-console
        console.log('\n📊 Stats:', JSON.stringify(stats, null, 2), '\n');
        askQuestion();
        return;
      }

      if (input.toLowerCase() === 'clear') {
        // eslint-disable-next-line no-console
        console.clear();
        askQuestion();
        return;
      }

      if (!input.trim()) {
        askQuestion();
        return;
      }

      // Process message
      const result = await runtime.handleMessage('cli', userId, chatId, input, {
        provider: options.provider,
        model: options.model,
      });

      if (result.success) {
        // eslint-disable-next-line no-console
        console.log(`\n🤖: ${result.response}`);
        if (result.costUsd && result.costUsd > 0) {
          // eslint-disable-next-line no-console
          console.log(`   💰 $${result.costUsd.toFixed(6)}`);
        }
        // eslint-disable-next-line no-console
        console.log();
      } else {
        // eslint-disable-next-line no-console
        console.error(`\n❌ Error: ${result.error}\n`);
      }

      askQuestion();
    });
  };

  askQuestion();
}

/**
 * Telegram bot mode
 */
async function runTelegram(runtime: PyrforRuntime): Promise<void> {
  logger.info('Running in Telegram bot mode');

  // Token: prefer config, fall back to env
  const tgConfig = runtime.config.telegram;
  const token = tgConfig.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.error('TELEGRAM_BOT_TOKEN not set');
    // eslint-disable-next-line no-console
    console.error('Error: set TELEGRAM_BOT_TOKEN env var or telegram.botToken in runtime.json');
    process.exit(1);
  }

  // Lazy-load grammY so users without --telegram don't pay for it
  let grammyMod: typeof import('grammy');
  let runnerMod: typeof import('@grammyjs/runner');
  try {
    grammyMod = await import('grammy');
    runnerMod = await import('@grammyjs/runner');
  } catch (err) {
    logger.error('grammY not installed', { error: String(err) });
    // eslint-disable-next-line no-console
    console.error('Error: grammy and @grammyjs/runner are required. Install with: npm install grammy @grammyjs/runner');
    process.exit(1);
    return;
  }

  type SessionData = Record<string, never>;
  type Ctx = import('grammy').Context & { session: SessionData };

  const { Bot, session } = grammyMod;
  const { run, sequentialize } = runnerMod;

  const bot = new Bot<Ctx>(token);
  const goalStore = new GoalStore();

  // ── Adapter: expose grammY bot as TelegramSender for runtime/tools ──────
  const sender = {
    async sendMessage(
      chatId: string | number,
      text: string,
      options?: { parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML' }
    ): Promise<unknown> {
      const cid = typeof chatId === 'string' ? Number(chatId) || chatId : chatId;
      try {
        return await bot.api.sendMessage(cid as number, text, {
          parse_mode: options?.parse_mode,
        });
      } catch {
        // Fallback to plain text if Markdown/HTML parsing fails
        return await bot.api.sendMessage(cid as number, text);
      }
    },
  };
  runtime.setTelegramBot(sender);

  // ── Update deduplication (OpenClaw pattern) ─────────────────────────────
  const seenUpdates = new Set<number>();
  const updateQueue: number[] = [];
  const isDuplicate = (id: number): boolean => {
    if (seenUpdates.has(id)) return true;
    seenUpdates.add(id);
    updateQueue.push(id);
    while (updateQueue.length > 200) {
      const old = updateQueue.shift();
      if (old !== undefined) seenUpdates.delete(old);
    }
    return false;
  };

  bot.use(async (ctx, next) => {
    if (ctx.update.update_id && isDuplicate(ctx.update.update_id)) {
      logger.debug('Duplicate update skipped', { updateId: ctx.update.update_id });
      return;
    }
    await next();
  });

  // ── Per-chat sequencing: messages from same chat processed in order ────
  bot.use(sequentialize((ctx) => (ctx.chat?.id ? `chat:${ctx.chat.id}` : undefined)));

  // ── Session middleware ─────────────────────────────────────────────────
  bot.use(session<SessionData, Ctx>({ initial: () => ({}) }));

  // ── ACL: only allow configured chat IDs (empty = open) ────────────────
  const numericAllowedChatIds = tgConfig.allowedChatIds
    .map((id) => (typeof id === 'string' ? parseInt(id, 10) : id))
    .filter((id) => !isNaN(id as number)) as number[];

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId !== undefined && !isAllowedChat(chatId, numericAllowedChatIds)) {
      logger.debug('[telegram] Chat not in allowedChatIds, ignoring', { chatId });
      return;
    }
    return next();
  });

  // ── Rate limit from config (per-minute sliding window) ────────────────
  const rateLimiter = createRateLimiter(tgConfig.rateLimitPerMinute);
  bot.use(async (ctx, next) => {
    if (!ctx.message) return next();
    const chatId = ctx.chat?.id ?? 0;
    if (!rateLimiter.allow(chatId)) {
      await ctx.reply('⏳ Слишком много запросов. Подождите минуту.').catch(() => {});
      return;
    }
    return next();
  });

  // ── Long-message helper with Markdown → plain text fallback ──────────
  const MAX_LEN = 4000;
  async function replyChunked(ctx: Ctx, text: string): Promise<void> {
    let rest = text;
    while (rest.length > 0) {
      const chunk = rest.slice(0, MAX_LEN);
      rest = rest.slice(MAX_LEN);
      try {
        await ctx.reply(chunk, { parse_mode: 'Markdown' });
      } catch {
        try {
          await ctx.reply(chunk);
        } catch (err) {
          logger.error('Failed to send Telegram chunk', { error: String(err) });
        }
      }
    }
  }

  // ── Progress event formatter ──────────────────────────────────────────────
  function formatProgress(event: ProgressEvent): string {
    switch (event.kind) {
      case 'tool-start': return `🔧 ${event.summary}`;
      case 'tool-end': return event.ok ? `✅ ${event.name} (${event.ms}ms)` : `❌ ${event.name}`;
      case 'llm-start': return `🧠 ${event.model}…`;
      case 'llm-end': return `🧠 ${event.model} (${event.ms}ms)`;
      case 'compact': return `📦 Сжимаю контекст (${event.tokensBefore} → ${event.tokensAfter})`;
    }
  }

  async function safeReact(
    ctx: { chat?: { id: number | string } | undefined; message?: { message_id: number } | undefined },
    emoji: string,
  ): Promise<void> {
    try {
      const cid = ctx.chat?.id;
      const mid = ctx.message?.message_id;
      if (cid === undefined || mid === undefined) return;
      await bot.api.setMessageReaction(Number(cid), mid, [
        { type: 'emoji', emoji } as never,
      ]);
    } catch (err) {
      logger.warn('[telegram] setMessageReaction failed', { emoji, error: String(err) });
    }
  }

  // ── Commands ────────────────────────────────────────────────────────────

  // Resolve Mini App public URL: config → env → localhost fallback
  const miniAppUrl = (() => {
    const fromConfig = (runtime.config as unknown as { gateway?: { publicUrl?: string } }).gateway?.publicUrl;
    const fromEnv = process.env.PYRFOR_PUBLIC_URL;
    const base = fromConfig || fromEnv || `http://localhost:${runtime.config.gateway?.port ?? 18790}`;
    return `${base.replace(/\/$/, '')}/app`;
  })();

  // Set chat menu button for a single chat (best-effort, HTTPS required in production)
  async function setMiniAppMenuButton(chatId: number): Promise<void> {
    try {
      await bot.api.raw.setChatMenuButton({
        chat_id: chatId,
        menu_button: { type: 'web_app', text: '🐾 Pyrfor', web_app: { url: miniAppUrl } },
      });
    } catch (err) {
      logger.warn('[telegram] setChatMenuButton failed (HTTPS required for web_app URLs in production)', {
        chatId, url: miniAppUrl, error: String(err),
      });
    }
  }

  bot.command('start', async (ctx) => {
    const chatId = ctx.chat?.id;
    await ctx.reply(
      '👋 Привет! Я Pyrfor — твой AI-ассистент.\n\nНапиши мне сообщение или открой приложение 👇',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🐾 Открыть Pyrfor', web_app: { url: miniAppUrl } },
          ]],
        },
      }
    );
    // Set menu button for this chat so the app is one tap away
    if (chatId !== undefined) {
      await setMiniAppMenuButton(chatId);
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `🤖 *Pyrfor — команды*\n\n` +
        `Просто пиши — я отвечу с помощью AI.\n\n` +
        `/start — начать диалог\n` +
        `/help — эта справка\n` +
        `/status — статус проектов (требует БД)\n` +
        `/projects — список проектов (требует БД)\n` +
        `/tasks — открытые задачи (требует БД)\n` +
        `/add_task <проект> <задача> — добавить задачу (требует БД)\n` +
        `/ai <вопрос> — прямой AI-запрос\n` +
        `/brief — утренний брифинг (требует БД)\n` +
        `/stats — статистика runtime\n` +
        `/clear — сбросить контекст диалога\n` +
        `/stop — остановить текущий запрос\n\n` +
        `🎯 *Цели:*\n` +
        `/goals — список активных целей\n` +
        `/progress — последняя активная цель\n` +
        `/newgoal <описание> — создать цель\n` +
        `/done <id> — завершить цель\n` +
        `/cancel <id> — отменить цель\n\n` +
        `🎤 Голосовые сообщения транскрибируются через Whisper.\n` +
        `📷 Фото и 📄 документы (.txt/.md/.csv/.json) обрабатываются автоматически.`,
      { parse_mode: 'Markdown' }
    );
  });

  // /status — PM-style project/task overview (requires Prisma)
  bot.command('status', async (ctx) => {
    const chatId = ctx.chat?.id ?? 0;
    const text = ctx.message?.text ?? '';
    const params = text.split(' ').slice(1);
    try {
      const reply = await handleStatus({ chatId, text, params });
      await replyChunked(ctx, reply);
    } catch (err) {
      logger.warn('[telegram] /status failed (Prisma not configured?)', { error: String(err) });
      await ctx.reply('⚠️ Команда недоступна: база данных не подключена.');
    }
  });

  // /projects — project list (requires Prisma)
  bot.command('projects', async (ctx) => {
    const chatId = ctx.chat?.id ?? 0;
    const text = ctx.message?.text ?? '';
    const params = text.split(' ').slice(1);
    try {
      const reply = await handleProjects({ chatId, text, params });
      await replyChunked(ctx, reply);
    } catch (err) {
      logger.warn('[telegram] /projects failed (Prisma not configured?)', { error: String(err) });
      await ctx.reply('⚠️ Команда недоступна: база данных не подключена.');
    }
  });

  // /tasks — open task list (requires Prisma)
  bot.command('tasks', async (ctx) => {
    const chatId = ctx.chat?.id ?? 0;
    const text = ctx.message?.text ?? '';
    const params = text.split(' ').slice(1);
    try {
      const reply = await handleTasks({ chatId, text, params });
      await replyChunked(ctx, reply);
    } catch (err) {
      logger.warn('[telegram] /tasks failed (Prisma not configured?)', { error: String(err) });
      await ctx.reply('⚠️ Команда недоступна: база данных не подключена.');
    }
  });

  // /add_task <project> <title> (requires Prisma)
  bot.command('add_task', async (ctx) => {
    const chatId = ctx.chat?.id ?? 0;
    const text = ctx.message?.text ?? '';
    const params = text.split(' ').slice(1);
    try {
      const reply = await handleAddTask({ chatId, text, params });
      await replyChunked(ctx, reply);
    } catch (err) {
      logger.warn('[telegram] /add_task failed (Prisma not configured?)', { error: String(err) });
      await ctx.reply('⚠️ Команда недоступна: база данных не подключена.');
    }
  });

  // /ai <query> — direct AI query via runtime
  bot.command('ai', async (ctx) => {
    const chatId = ctx.chat?.id ?? 0;
    const userId = String(ctx.from?.id ?? 'unknown');
    const text = ctx.message?.text ?? '';
    const params = text.split(' ').slice(1);

    await ctx.replyWithChatAction('typing').catch(() => {});

    const runMessage = async (query: string): Promise<string> => {
      const result = await runtime.handleMessage('telegram', userId, String(chatId), query);
      return result.response || result.error || 'Нет ответа.';
    };

    try {
      const reply = await handleAi({ chatId, text, params }, runMessage);
      await replyChunked(ctx, reply);
    } catch (err) {
      logger.error('[telegram] /ai failed', { error: String(err) });
      await ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // /brief — morning briefing (requires Prisma)
  bot.command('brief', async (ctx) => {
    const chatId = ctx.chat?.id ?? 0;
    const text = ctx.message?.text ?? '';
    const params = text.split(' ').slice(1);
    try {
      const reply = await handleMorningBrief({ chatId, text, params });
      await replyChunked(ctx, reply);
    } catch (err) {
      logger.warn('[telegram] /brief failed (Prisma not configured?)', { error: String(err) });
      await ctx.reply('⚠️ Команда недоступна: база данных не подключена.');
    }
  });

  // ── Goal commands ─────────────────────────────────────────────────────
  bot.command('goals', async (ctx) => {
    const goals = goalStore.list('active');
    if (goals.length === 0) {
      await ctx.reply('🎯 Активных целей нет.\n\nИспользуй `/newgoal <описание>` для создания.', { parse_mode: 'Markdown' });
      return;
    }
    let text = '🎯 *Активные цели:*\n\n';
    goals.forEach((g, i) => {
      text += `${i + 1}. ⏳ ${g.description}\n   ID: \`${g.id}\`\n\n`;
    });
    text += 'Используй /progress для деталей.';
    await replyChunked(ctx, text);
  });

  bot.command('progress', async (ctx) => {
    const goals = goalStore.list('active');
    const goal = goals[goals.length - 1];
    if (!goal) {
      await ctx.reply('ℹ️ Нет активных целей.');
      return;
    }
    const text =
      `🎯 *Текущая цель*\n\n` +
      `*ID:* \`${goal.id}\`\n` +
      `*Статус:* ⏳ active\n` +
      `*Описание:* ${goal.description}\n` +
      `*Создана:* ${new Date(goal.createdAt).toLocaleString('ru-RU')}`;
    await replyChunked(ctx, text);
  });

  bot.command('newgoal', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const description = text.split(' ').slice(1).join(' ').trim();
    if (!description) {
      await ctx.reply('⚠️ Укажи описание цели: `/newgoal <описание>`', { parse_mode: 'Markdown' });
      return;
    }
    const goal = goalStore.create(description);
    await ctx.reply(
      `✅ Цель создана!\n\n*ID:* \`${goal.id}\`\n*Описание:* ${description}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('done', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const id = text.split(' ')[1]?.trim();
    if (!id) {
      await ctx.reply('⚠️ Укажи ID цели: `/done <id>`', { parse_mode: 'Markdown' });
      return;
    }
    const goal = goalStore.markDone(id);
    if (!goal) {
      await ctx.reply(`❌ Цель с ID \`${id}\` не найдена.`, { parse_mode: 'Markdown' });
      return;
    }
    await ctx.reply(`✅ Цель завершена: ${goal.description}`, { parse_mode: 'Markdown' });
  });

  bot.command('cancel', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const id = text.split(' ')[1]?.trim();
    if (!id) {
      await ctx.reply('⚠️ Укажи ID цели: `/cancel <id>`', { parse_mode: 'Markdown' });
      return;
    }
    const goal = goalStore.cancel(id);
    if (!goal) {
      await ctx.reply(`❌ Цель с ID \`${id}\` не найдена.`, { parse_mode: 'Markdown' });
      return;
    }
    await ctx.reply(`🚫 Цель отменена: ${goal.description}`);
  });

  bot.command('stats', async (ctx) => {
    const stats = runtime.getStats();
    const text =
      `📈 *Подробная статистика*\n\n` +
      `*Sessions*\n` +
      `• Active: ${stats.sessions.active}\n` +
      `• Tokens: ${stats.sessions.totalTokens}\n\n` +
      `*Providers*\n` +
      `• Available: ${stats.providers.available.join(', ') || 'none'}\n` +
      `• Cost USD: ${stats.providers.costs.totalUsd.toFixed(4)}\n\n` +
      `*Workspace*\n` +
      `• Loaded: ${stats.workspace.loaded ? '✅' : '❌'}`;
    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  bot.command('clear', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    const userId = String(ctx.from?.id ?? 'unknown');
    const cleared = runtime.clearSession('telegram', userId, chatId);
    await ctx.reply(cleared ? '🧹 Контекст диалога сброшен.' : 'ℹ️ Активной сессии нет.');
  });

  // ── Active pipelines registry (A3 typing refresh + A7 /stop + A11 cancel) ──
  const activePipelines = new Map<string, AbortController>();
  let isShuttingDown = false;

  const runWithTypingAndStop = async (
    ctx: { chat?: { id: number | string } | undefined; replyWithChatAction: (a: 'typing') => Promise<unknown>; reply: (m: string) => Promise<unknown> },
    work: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> => {
    const chatId = String(ctx.chat?.id ?? '');
    if (isShuttingDown) {
      await ctx.reply('⏸ Бот выключается, попробуй позже.').catch(() => {});
      return;
    }
    const existing = activePipelines.get(chatId);
    if (existing) {
      existing.abort();
    }
    const controller = new AbortController();
    activePipelines.set(chatId, controller);
    await ctx.replyWithChatAction('typing').catch(() => {});
    const refreshInterval = setInterval(() => {
      void ctx.replyWithChatAction('typing').catch(() => {});
    }, 4000);
    try {
      await work(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        logger.info('Pipeline aborted', { chatId });
      } else {
        logger.error('Pipeline failed', { chatId, error: String(err) });
        await ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
      }
    } finally {
      clearInterval(refreshInterval);
      if (activePipelines.get(chatId) === controller) activePipelines.delete(chatId);
    }
  };

  bot.command('stop', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '');
    const ctrl = activePipelines.get(chatId);
    if (ctrl) {
      ctrl.abort();
      activePipelines.delete(chatId);
      await ctx.reply('🛑 Текущий запрос остановлен.');
    } else {
      await ctx.reply('ℹ️ Активного запроса нет.');
    }
  });

  // ── Voice handler (uses runtime/voice module) ──────────────────────────
  bot.on('message:voice', async (ctx) => {
    const voice = ctx.message.voice;
    if (!voice) return;

    await safeReact(ctx, '👀');

    await runWithTypingAndStop(ctx, async (signal) => {
      let transcribedText: string;
      try {
        transcribedText = await transcribeTelegramVoice({
          botToken: token,
          fileId: voice.file_id,
          voiceConfig: runtime.config.voice,
        });
      } catch (err) {
        logger.error('Voice transcription failed', { error: String(err) });
        await safeReact(ctx, '❌');
        await ctx.reply('❌ Не удалось распознать голос. Попробуй текстом.');
        return;
      }

      if (signal.aborted) return;
      if (!transcribedText.trim()) {
        await ctx.reply('🤷 Не услышал слов. Попробуй ещё раз.');
        return;
      }

      await ctx.reply(`🎤 _${transcribedText}_`, { parse_mode: 'Markdown' }).catch(() => {});

      const chatId = String(ctx.chat.id);
      const userId = String(ctx.from?.id ?? 'unknown');
      const result = await runtime.handleMessage('telegram', userId, chatId, transcribedText);
      if (signal.aborted) return;

      if (result.success) {
        await safeReact(ctx, '✅');
        await replyChunked(ctx, result.response);
      } else {
        await safeReact(ctx, '❌');
        await ctx.reply(`❌ Ошибка: ${result.error ?? 'unknown'}`);
      }
    });
  });

  // ── Photo handler ─────────────────────────────────────────────────────────
  bot.on('message:photo', async (ctx) => {
    await safeReact(ctx, '👀');
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    if (!photo) return;

    try {
      const file = await ctx.api.getFile(photo.file_id);
      const filePath = file.file_path;
      const fileUrl = filePath
        ? `https://api.telegram.org/file/bot${token}/${filePath}`
        : null;

      const modelName = runtime.config.providers?.defaultProvider ?? '';
      const supportsVision = /gpt-4o|claude|gemini|glm-4v|qwen-vl/i.test(String(modelName));

      if (supportsVision && fileUrl) {
        // TODO: Pass image URL to handleMessage for vision processing
        const chatId = String(ctx.chat.id);
        const userId = String(ctx.from?.id ?? 'unknown');
        const prompt = `[Описание прикреплённого фото: ${fileUrl}]\n${ctx.message.caption ?? 'Опиши это фото'}`;
        await runWithTypingAndStop(ctx, async (signal) => {
          const result = await runtime.handleMessage('telegram', userId, chatId, prompt);
          if (signal.aborted) return;
          if (result.success) {
            await safeReact(ctx, '✅');
            await replyChunked(ctx, result.response);
          } else {
            await safeReact(ctx, '❌');
            await ctx.reply(`❌ Ошибка: ${result.error ?? 'unknown'}`);
          }
        });
      } else {
        await safeReact(ctx, '✅');
        await ctx.reply(
          `📷 Фото получено${fileUrl ? '' : ' (файл недоступен)'}.\n` +
          `⚠️ Текущая модель (${modelName || 'default'}) не поддерживает vision.\n` +
          `Переключитесь на gpt-4o, claude, или gemini для анализа фото.\n` +
          `// TODO: vision integration`
        );
      }
    } catch (err) {
      logger.error('[telegram] Photo handler failed', { error: String(err) });
      await safeReact(ctx, '❌');
      await ctx.reply(`❌ Ошибка при обработке фото: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    }
  });

  // ── Document handler ───────────────────────────────────────────────────────
  bot.on('message:document', async (ctx) => {
    await safeReact(ctx, '👀');
    const doc = ctx.message.document;
    if (!doc) return;

    const MAX_DOC_SIZE = 10 * 1024 * 1024;
    if (doc.file_size && doc.file_size > MAX_DOC_SIZE) {
      await safeReact(ctx, '❌');
      await ctx.reply(`❌ Файл слишком большой (${Math.round(doc.file_size / 1024 / 1024)}MB). Максимум: 10MB.`);
      return;
    }

    const name = doc.file_name ?? `file_${doc.file_id}`;
    const ext = path.extname(name).toLowerCase();
    const textLike = ['.txt', '.md', '.csv', '.json', '.ts', '.js', '.py', '.yaml', '.yml', '.toml'];

    try {
      const file = await ctx.api.getFile(doc.file_id);
      const filePath = file.file_path;

      if (!filePath) {
        await safeReact(ctx, '❌');
        await ctx.reply('❌ Не удалось получить ссылку на файл.');
        return;
      }

      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

      const inboxDir = path.join(homedir(), '.pyrfor', 'inbox');
      mkdirSync(inboxDir, { recursive: true });
      const savePath = path.join(inboxDir, name);

      const resp = await fetch(fileUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      writeFS(savePath, buffer);

      if (textLike.includes(ext)) {
        const content = buffer.toString('utf-8');
        const chatId = String(ctx.chat.id);
        const userId = String(ctx.from?.id ?? 'unknown');
        const prompt = `[Содержимое файла ${name}]\n${content}`;
        await runWithTypingAndStop(ctx, async (signal) => {
          const result = await runtime.handleMessage('telegram', userId, chatId, prompt);
          if (signal.aborted) return;
          if (result.success) {
            await safeReact(ctx, '✅');
            await replyChunked(ctx, result.response);
          } else {
            await safeReact(ctx, '❌');
            await ctx.reply(`❌ Ошибка: ${result.error ?? 'unknown'}`);
          }
        });
      } else {
        // TODO: MarkItDown integration for PDF/DOCX/XLSX parsing
        await safeReact(ctx, '✅');
        await ctx.reply(
          `📄 Документ сохранён: ~/.pyrfor/inbox/${name}\n` +
          `(PDF/Office parsing будет в следующей итерации)`
        );
      }
    } catch (err) {
      logger.error('[telegram] Document handler failed', { error: String(err) });
      await safeReact(ctx, '❌');
      await ctx.reply(`❌ Ошибка при обработке документа: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    }
  });

  // ── Text handler ───────────────────────────────────────────────────────
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // commands handled above

    await safeReact(ctx, '👀');

    await runWithTypingAndStop(ctx, async (signal) => {
      const chatId = String(ctx.chat.id);
      const userId = String(ctx.from?.id ?? 'unknown');

      const live = new LiveActivity(bot.api, ctx.chat.id);
      await live.start('⚙️ Работаю...');
      const progressLines: string[] = [];

      try {
        const result = await runtime.handleMessage('telegram', userId, chatId, text, {
          onProgress: (event) => {
            const line = formatProgress(event);
            progressLines.push(line);
            const display = progressLines.slice(-10).join('\n');
            void live.update(`⚙️ Работаю...\n\n${display}`).catch(() => {});
          },
        });

        if (signal.aborted) return;

        if (result.success) {
          await live.complete(`✅ Готово`, 60_000);
          await safeReact(ctx, '✅');
          await replyChunked(ctx, result.response);
        } else {
          await live.complete(`❌ Ошибка`);
          await safeReact(ctx, '❌');
          await ctx.reply(`❌ Ошибка: ${result.error ?? 'unknown'}`);
        }
      } catch (err) {
        await live.complete(`❌ Ошибка`, 30_000);
        await safeReact(ctx, '❌');
        throw err;
      }
    });
  });

  // ── Approval flow: inline keyboard for dangerous tool calls ──────────────

  // Determine the admin chat ID for approval prompts
  const approvalAdminChatId: number | undefined =
    (tgConfig as Record<string, unknown>).adminChatId !== undefined
      ? Number((tgConfig as Record<string, unknown>).adminChatId)
      : numericAllowedChatIds[0];

  approvalFlow.events.on('approval-requested', async (req: { id: string; toolName: string; summary: string }) => {
    if (approvalAdminChatId === undefined || isNaN(approvalAdminChatId)) {
      logger.warn('Approval requested but no admin chat ID configured — tool will wait for TTL', {
        toolName: req.toolName,
        id: req.id,
      });
      return;
    }
    try {
      await bot.api.sendMessage(
        approvalAdminChatId,
        `⚠️ Подтвердите действие:\n\n\`${req.summary}\``,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Разрешить', callback_data: `approve:${req.id}` },
                { text: '❌ Отклонить', callback_data: `deny:${req.id}` },
              ],
            ],
          },
        },
      );
    } catch (err) {
      logger.error('Failed to send approval prompt via Telegram', {
        error: String(err),
        toolName: req.toolName,
        id: req.id,
      });
    }
  });

  // ── Approval callback handler ──────────────────────────────────────────
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data) return;

    if (data.startsWith('approve:') || data.startsWith('deny:')) {
      const decision = data.startsWith('approve:') ? 'approve' : 'deny';
      const id = data.startsWith('approve:') ? data.slice(8) : data.slice(5);

      approvalFlow.resolveDecision(id, decision);

      const label = decision === 'approve' ? '✅ Разрешено' : '❌ Отклонено';
      await ctx.answerCallbackQuery({ text: label }).catch(() => {});

      // Edit the original message to remove inline keyboard and append decision
      try {
        const msg = ctx.callbackQuery.message;
        if (msg) {
          const originalText = 'text' in msg ? (msg.text ?? '') : '';
          await ctx.api.editMessageText(
            msg.chat.id,
            msg.message_id,
            `${originalText}\n\n${label}`,
            { reply_markup: { inline_keyboard: [] } },
          );
        }
      } catch {
        // Ignore edit failures (e.g. message too old)
      }
      return;
    }
    // Other callback_query:data handlers can be added here or before this block
  });

  // ── Global error handler ────────────────────────────────────────────────
  bot.catch((err) => {
    logger.error('grammY bot error', {
      error: err.error instanceof Error ? err.error.message : String(err.error),
      updateId: err.ctx?.update?.update_id,
    });
  });

  // ── Start polling via @grammyjs/runner ──────────────────────────────────
  const runner = run(bot, {
    runner: {
      fetch: {
        allowed_updates: ['message', 'callback_query', 'edited_message'],
      },
    },
  });

  logger.info('Telegram bot started (grammY polling mode)');

  // ── Graceful shutdown ───────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Shutting down Telegram bot (${signal})...`);

    // A11: cancel active subagent pipelines first.
    for (const [chatId, ctrl] of activePipelines) {
      try { ctrl.abort(); } catch { /* ignore */ }
      logger.info('Aborted active pipeline on shutdown', { chatId });
    }

    // A10: drain in-flight handlers (give them up to 5s to settle).
    const drainStart = Date.now();
    while (activePipelines.size > 0 && Date.now() - drainStart < 5000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (activePipelines.size > 0) {
      logger.warn('Drain timeout; abandoning in-flight pipelines', { count: activePipelines.size });
    }

    try {
      await runner.stop();
    } catch (err) {
      logger.warn('Runner stop failed', { error: String(err) });
    }
    try {
      await runtime.stop();
    } catch (err) {
      logger.warn('Runtime stop failed', { error: String(err) });
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Keep running until runner stops
  await runner.task();
}

/**
 * One-shot mode
 */
async function runOnce(runtime: PyrforRuntime, options: CLIOptions): Promise<void> {
  const message = options.message;
  if (!message) {
    // eslint-disable-next-line no-console
    console.error('Error: Message required. Use --once "your question"');
    process.exit(1);
  }

  logger.info('Running in one-shot mode', { message: message.slice(0, 100) });

  const result = await runtime.handleMessage('cli', 'cli-user', 'cli-chat', message, {
    provider: options.provider,
    model: options.model,
  });

  if (result.success) {
    // eslint-disable-next-line no-console
    console.log(result.response);
    if (result.costUsd && result.costUsd > 0) {
      // eslint-disable-next-line no-console
      console.error(`\n[Cost: $${result.costUsd.toFixed(6)}]`);
    }
  } else {
    // eslint-disable-next-line no-console
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  await runtime.stop();
  process.exit(0);
}

// ============================================
// Service Subcommands
// ============================================

/**
 * Handles `service install|uninstall|status` — bypasses normal runtime startup.
 */
async function runService(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    // eslint-disable-next-line no-console
    console.log(`Usage: pyrfor-runtime service <subcommand> [options]

Subcommands:
  install     Install as OS service (LaunchAgent on macOS, systemd on Linux)
  uninstall   Remove OS service
  status      Print service status as JSON

Install options:
  --env-file <path>   Path to .env file (default: .env in cwd if it exists)
  --exec <path>       Executable path (default: current node process)
  --workdir <dir>     Working directory (default: cwd)
`);
    process.exit(0);
  }

  const cwd = process.cwd();

  if (subcommand === 'install') {
    let envFile: string | undefined;
    let executablePath = process.execPath;
    let workdir = cwd;

    for (let i = 1; i < args.length; i++) {
      switch (args[i]) {
        case '--env-file':
          envFile = args[++i];
          break;
        case '--exec':
          executablePath = args[++i];
          break;
        case '--workdir':
          workdir = args[++i];
          break;
      }
    }

    // Default envFile: .env in cwd if present
    if (!envFile) {
      const defaultEnv = path.join(cwd, '.env');
      try {
        await fsAccess(defaultEnv);
        envFile = defaultEnv;
      } catch {
        // no .env in cwd — leave undefined
      }
    }

    const manager = createServiceManager({ workingDir: workdir });
    const scriptPath = process.argv[1];
    await manager.install({ envFile, executablePath, args: [scriptPath, '--telegram'] });
    // eslint-disable-next-line no-console
    console.log('Installed dev.pyrfor.runtime — autostart enabled.');
    process.exit(0);
  }

  if (subcommand === 'uninstall') {
    let workdir = cwd;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--workdir') workdir = args[++i];
    }
    const manager = createServiceManager({ workingDir: workdir });
    await manager.uninstall();
    // eslint-disable-next-line no-console
    console.log('Uninstalled dev.pyrfor.runtime — service removed.');
    process.exit(0);
  }

  if (subcommand === 'status') {
    const manager = createServiceManager({ workingDir: cwd });
    const result = await manager.status();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`Unknown service subcommand: ${subcommand}`);
  // eslint-disable-next-line no-console
  console.error('Valid subcommands: install, uninstall, status');
  process.exit(1);
}

// ============================================
// Migrate Subcommand
// ============================================

/**
 * Handles `migrate sessions [--dry-run] [--overwrite] [--from <path>] [--channel <name>]`
 */
async function runMigrate(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    // eslint-disable-next-line no-console
    console.log(`Usage: pyrfor-runtime migrate sessions [options]

Options:
  --dry-run          Show what would be imported without writing any files
  --overwrite        Overwrite existing destination files
  --from <path>      Additional legacy root directory to scan (can repeat)
  --channel <name>   Channel name to use when not inferrable (default: imported)
`);
    process.exit(0);
  }

  if (subcommand !== 'sessions') {
    // eslint-disable-next-line no-console
    console.error(`Unknown migrate subcommand: ${subcommand}`);
    // eslint-disable-next-line no-console
    console.error('Valid subcommands: sessions');
    process.exit(1);
  }

  let dryRun = false;
  let overwrite = false;
  let channel = 'imported';
  const extraRoots: string[] = [];

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--overwrite':
        overwrite = true;
        break;
      case '--channel':
        channel = args[++i] ?? channel;
        break;
      case '--from':
        if (args[i + 1]) extraRoots.push(args[++i]);
        break;
    }
  }

  const destRoot = path.join(homedir(), '.pyrfor', 'sessions');

  // eslint-disable-next-line no-console
  console.log(`Discovering legacy session stores…`);
  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log('(dry-run mode — no files will be written)');
  }

  const stores = await discoverLegacyStores(extraRoots.length > 0 ? extraRoots : undefined);

  if (stores.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No legacy stores found. Nothing to migrate.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.log(`Found ${stores.length} legacy file(s). Starting migration…\n`);

  let totalImported = 0;
  let totalSkipped = 0;
  const totalErrors: Array<{ file?: string; msg: string }> = [];
  const totalFiles: string[] = [];

  for (const store of stores) {
    const report = await migrateLegacyStore(store, {
      destRoot,
      channel,
      dryRun,
      overwrite,
      onProgress: (msg) => console.log(' ', msg), // eslint-disable-line no-console
    });
    totalImported += report.imported;
    totalSkipped += report.skipped;
    totalErrors.push(...report.errors);
    totalFiles.push(...report.files);
  }

  // eslint-disable-next-line no-console
  console.log(`
Migration complete:
  Imported : ${totalImported}
  Skipped  : ${totalSkipped}
  Errors   : ${totalErrors.length}
  Files    : ${totalFiles.length}`);

  if (totalErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.error('\nErrors:');
    for (const e of totalErrors) {
      // eslint-disable-next-line no-console
      console.error(`  ${e.file ? e.file + ': ' : ''}${e.msg}`);
    }
  }

  process.exit(totalErrors.length > 0 ? 1 : 0);
}

// ============================================
// Backup Subcommand
// ============================================

/**
 * Handles:
 *   pyrfor-runtime backup [--out <path>]
 *   pyrfor-runtime backup list
 */
async function runBackup(args: string[]): Promise<void> {
  const { createBackup, listBackups } = await import('./backup');

  if (args[0] === 'list') {
    const entries = await listBackups({});
    if (entries.length === 0) {
      // eslint-disable-next-line no-console
      console.log('No backups found.');
      process.exit(0);
    }
    // eslint-disable-next-line no-console
    console.log(`${'Name'.padEnd(50)} ${'Size (bytes)'.padStart(12)}  Modified`);
    // eslint-disable-next-line no-console
    console.log('-'.repeat(80));
    for (const e of entries) {
      // eslint-disable-next-line no-console
      console.log(`${e.name.padEnd(50)} ${String(e.bytes).padStart(12)}  ${e.mtime.toISOString()}`);
    }
    process.exit(0);
  }

  let outputPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--out' || args[i] === '-o') && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  const result = await createBackup({ outputPath });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// ============================================
// Restore Subcommand
// ============================================

/**
 * Handles: pyrfor-runtime restore <archive> [--force]
 */
async function runRestore(args: string[]): Promise<void> {
  const { restoreBackup } = await import('./backup');

  const archivePath = args[0];
  if (!archivePath || archivePath === '--help' || archivePath === '-h') {
    // eslint-disable-next-line no-console
    console.log(`Usage: pyrfor-runtime restore <archive> [--force]

Arguments:
  <archive>   Path to the .tar.gz backup file

Options:
  --force     Overwrite existing target directory (renames old dir to .bak-<timestamp>)
`);
    process.exit(0);
  }

  const force = args.includes('--force');

  const result = await restoreBackup({ archivePath, force });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// ============================================
// Token Subcommand
// ============================================

/**
 * Handles `token rotate [--label <name>] [--ttl-days <n>] [--config <path>]`
 *
 * Generates a 32-byte random token, appends it to gateway.bearerTokens in the
 * config file, and prints the new token to stdout (one-time display).
 */
async function runToken(args: string[]): Promise<void> {
  const { randomBytes } = await import('crypto');
  const { saveConfig } = await import('./config');

  const subcommand = args[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    // eslint-disable-next-line no-console
    console.log(`Usage: pyrfor-runtime token <subcommand> [options]

Subcommands:
  rotate   Generate a new bearer token and append it to the config

Rotate options:
  --label <name>    Human-readable label for this token (default: none)
  --ttl-days <n>    Token lifetime in days; omit for no expiry
  --config, -c      Path to runtime.json (default: ~/.pyrfor/runtime.json)

Notes:
  The new token is printed ONCE to stdout — copy it now.
  If config save fails, a JSON snippet is printed for manual insertion.
`);
    process.exit(0);
  }

  if (subcommand !== 'rotate') {
    // eslint-disable-next-line no-console
    console.error(`Unknown token subcommand: ${subcommand}`);
    // eslint-disable-next-line no-console
    console.error('Valid subcommands: rotate');
    process.exit(1);
  }

  let label: string | undefined;
  let ttlDays: number | undefined;
  let configPath: string | undefined;

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--label':
        label = args[++i];
        break;
      case '--ttl-days':
        ttlDays = parseInt(args[++i] ?? '', 10);
        if (isNaN(ttlDays) || ttlDays <= 0) {
          // eslint-disable-next-line no-console
          console.error('--ttl-days must be a positive integer');
          process.exit(1);
        }
        break;
      case '--config':
      case '-c':
        configPath = args[++i];
        break;
    }
  }

  // Generate token
  const newToken = randomBytes(32).toString('hex');

  const expiresAt = ttlDays != null
    ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  const entry: { value: string; expiresAt?: string; label?: string } = { value: newToken };
  if (expiresAt) entry.expiresAt = expiresAt;
  if (label) entry.label = label;

  // Load config, append new token, save
  const resolvedConfigPath = configPath ?? DEFAULT_CONFIG_PATH;
  let saved = false;
  try {
    const { config } = await loadConfig(resolvedConfigPath);
    const updated = {
      ...config,
      gateway: {
        ...config.gateway,
        bearerTokens: [...(config.gateway.bearerTokens ?? []), entry],
      },
    };
    await saveConfig(updated, resolvedConfigPath);
    saved = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[token rotate] Could not auto-save config: ${(err as Error).message}`);
    // eslint-disable-next-line no-console
    console.error('Add the following JSON snippet to gateway.bearerTokens in your config manually:');
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(entry, null, 2));
  }

  // Always print the token — it is shown only once
  // eslint-disable-next-line no-console
  console.log(newToken);

  if (saved) {
    logger.info('[token rotate] New token appended to config', {
      label: entry.label,
      expiresAt: entry.expiresAt,
      configPath: resolvedConfigPath,
    });
  }

  process.exit(0);
}

// ============================================
// Export-Trajectories Subcommand
// ============================================

/**
 * Parse `--since` flag value.
 *   "7d"  → 7 days ago
 *   "30d" → 30 days ago
 *   ISO   → exact Date
 * Throws a descriptive error for unrecognised values.
 */
export function parseSince(raw: string): Date {
  const shorthand = /^(\d+)d$/i.exec(raw);
  if (shorthand) {
    const days = parseInt(shorthand[1], 10);
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid --since value: "${raw}". Use ISO date or shorthand like 7d / 30d.`);
  }
  return d;
}

/**
 * Handler for `pyrfor export-trajectories [flags]`.
 * Exported so integration tests can call it directly (without spawning a child process).
 */
export async function runExportTrajectories(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    // eslint-disable-next-line no-console
    console.log(`Usage: pyrfor-runtime export-trajectories --out=<path> [options]

Options:
  --out=<path>            (required) Output file path
  --format=<fmt>          Output format: sharegpt | jsonl | openai  (default: sharegpt)
  --since=<ISO|7d|30d>    Only records started on/after this date
  --until=<ISO>           Only records started on/before this date
  --channel=<name>        Filter by channel
  --success-only          Exclude failed trajectories
  --include-private       Include records marked private:true
  --min-tools=<N>         Skip trajectories with fewer than N tool calls
  --base-dir=<path>       Trajectory storage directory (default: ~/.pyrfor/trajectories)
`);
    process.exit(0);
  }

  const opts: Partial<ExportOptions> & { outPath?: string } = {
    format: 'sharegpt',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Support both --flag=value and --flag value styles
    const eqIdx = arg.indexOf('=');
    const key = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
    const eqVal = eqIdx !== -1 ? arg.slice(eqIdx + 1) : undefined;
    const nextVal = (): string => {
      if (eqVal !== undefined) return eqVal;
      if (args[i + 1] !== undefined) return args[++i];
      throw new Error(`Flag ${key} requires a value`);
    };

    switch (key) {
      case '--out':
        opts.outPath = nextVal();
        break;
      case '--format': {
        const fmt = nextVal() as ExportOptions['format'];
        if (fmt !== 'sharegpt' && fmt !== 'jsonl' && fmt !== 'openai') {
          process.stderr.write(`Error: --format must be one of: sharegpt, jsonl, openai\n`);
          process.exit(1);
        }
        opts.format = fmt;
        break;
      }
      case '--since':
        try {
          opts.since = parseSince(nextVal());
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exit(1);
        }
        break;
      case '--until':
        opts.until = new Date(nextVal());
        if (isNaN(opts.until.getTime())) {
          process.stderr.write(`Error: --until value is not a valid date\n`);
          process.exit(1);
        }
        break;
      case '--channel':
        opts.channel = nextVal();
        break;
      case '--success-only':
        opts.successOnly = true;
        break;
      case '--include-private':
        opts.includePrivate = true;
        break;
      case '--min-tools': {
        const n = parseInt(nextVal(), 10);
        if (isNaN(n) || n < 0) {
          process.stderr.write(`Error: --min-tools must be a non-negative integer\n`);
          process.exit(1);
        }
        opts.minToolCalls = n;
        break;
      }
      case '--base-dir':
        opts.baseDir = nextVal();
        break;
      default:
        process.stderr.write(`Error: Unknown flag: ${key}\n`);
        process.exit(1);
    }
  }

  if (!opts.outPath) {
    process.stderr.write(`Error: --out=<path> is required\n`);
    process.exit(1);
  }

  try {
    const result = await exportTrajectoriesToFile(opts as ExportOptions);
    // eslint-disable-next-line no-console
    console.log(
      `✓ Exported ${result.exported} trajectories (${result.skipped} skipped) to ${result.outPath} (${result.bytes} bytes, format: ${result.formatUsed})`,
    );
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

// ============================================
// Main Entry Point
// ============================================

async function main(): Promise<void> {
  // Service subcommands bypass normal runtime startup
  if (process.argv[2] === 'service') {
    await runService(process.argv.slice(3));
    return;
  }

  // Migrate subcommands bypass normal runtime startup
  if (process.argv[2] === 'migrate') {
    await runMigrate(process.argv.slice(3));
    return;
  }

  // Token subcommands bypass normal runtime startup
  if (process.argv[2] === 'token') {
    await runToken(process.argv.slice(3));
    return;
  }

  // MCP stdio server — no runtime required, talks directly to the tool layer
  if (process.argv[2] === 'mcp') {
    const { runMcpStdio } = await import('./mcp-server');
    await runMcpStdio();
    return;
  }

  // Backup subcommands bypass normal runtime startup
  if (process.argv[2] === 'backup') {
    await runBackup(process.argv.slice(3));
    return;
  }

  // Restore subcommand bypasses normal runtime startup
  if (process.argv[2] === 'restore') {
    await runRestore(process.argv.slice(3));
    return;
  }

  // Export-trajectories subcommand bypasses normal runtime startup
  if (process.argv[2] === 'export-trajectories') {
    await runExportTrajectories(process.argv.slice(3));
    return;
  }

  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Load config (pre-load to resolve workspace path and persistence options;
  // PyrforRuntime will reload from the same path in start() for hot-reload).
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  const { config } = await loadConfig(configPath).catch((err) => {
    logger.warn('[cli] Config load failed, using defaults', { error: String(err) });
    return { config: undefined };
  });

  // Create and start runtime
  const runtime = new PyrforRuntime({
    workspacePath: options.workspacePath || config?.workspacePath || DEFAULT_WORKSPACE_PATH,
    providerOptions: {
      defaultProvider: options.provider,
      enableFallback: config?.providers.enableFallback,
    },
    persistence: config?.persistence.enabled === false
      ? false
      : {
          rootDir: config?.persistence.rootDir,
          debounceMs: config?.persistence.debounceMs,
        },
    configPath,
  });

  await runtime.start();

  const stats = runtime.getStats();
  logger.info('Runtime started', {
    workspace: stats.workspace.loaded,
    availableProviders: stats.providers.available,
  });

  // Run in selected mode
  switch (options.mode) {
    case 'daemon':
      await runDaemon(runtime);
      break;

    case 'chat':
      await runChat(runtime, options);
      break;

    case 'telegram':
      await runTelegram(runtime);
      break;

    case 'once':
      await runOnce(runtime, options);
      break;
  }
}

// Run main
main().catch((error) => {
  logger.error('Fatal error', { error: String(error) });
  // eslint-disable-next-line no-console
  console.error('Fatal error:', error);
  process.exit(1);
});

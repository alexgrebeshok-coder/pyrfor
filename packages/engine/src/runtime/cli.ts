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
import path from 'path';
import { PyrforRuntime } from './index';
import { logger } from '../observability/logger';
import { loadConfig, DEFAULT_CONFIG_PATH } from './config';
import { transcribeTelegramVoice } from './voice';
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

Options:
  --chat              Interactive CLI mode
  --telegram          Telegram bot mode
  --once "question"   One-shot question and exit
  --workspace, -w     Workspace path (default: ~/.openclaw/workspace)
  --config, -c        Path to runtime.json config (default: ~/.pyrfor/runtime.json)
  --provider, -p      Default AI provider (zai, openrouter, ollama)
  --model, -m         Model to use
  --help, -h          Show this help

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

  // ── Commands ────────────────────────────────────────────────────────────

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '👋 Привет! Я Pyrfor — твой AI-ассистент.\n\nНапиши мне сообщение или отправь голосовое.'
    );
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
        `/clear — сбросить контекст диалога\n\n` +
        `🎤 Голосовые сообщения транскрибируются через Whisper.`,
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

  // ── Voice handler (uses runtime/voice module) ──────────────────────────
  bot.on('message:voice', async (ctx) => {
    const voice = ctx.message.voice;
    if (!voice) return;

    await ctx.replyWithChatAction('typing').catch(() => {});

    let transcribedText: string;
    try {
      transcribedText = await transcribeTelegramVoice({
        botToken: token,
        fileId: voice.file_id,
        voiceConfig: runtime.config.voice,
      });
    } catch (err) {
      logger.error('Voice transcription failed', { error: String(err) });
      await ctx.reply('❌ Не удалось распознать голос. Попробуй текстом.');
      return;
    }

    if (!transcribedText.trim()) {
      await ctx.reply('🤷 Не услышал слов. Попробуй ещё раз.');
      return;
    }

    await ctx.reply(`🎤 _${transcribedText}_`, { parse_mode: 'Markdown' }).catch(() => {});

    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from?.id ?? 'unknown');
    const result = await runtime.handleMessage('telegram', userId, chatId, transcribedText);

    if (result.success) {
      await replyChunked(ctx, result.response);
    } else {
      await ctx.reply(`❌ Ошибка: ${result.error ?? 'unknown'}`);
    }
  });

  // ── Text handler ───────────────────────────────────────────────────────
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // commands handled above

    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from?.id ?? 'unknown');

    await ctx.replyWithChatAction('typing').catch(() => {});

    const result = await runtime.handleMessage('telegram', userId, chatId, text);

    if (result.success) {
      await replyChunked(ctx, result.response);
    } else {
      await ctx.reply(`❌ Ошибка: ${result.error ?? 'unknown'}`);
    }
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
    logger.info(`Shutting down Telegram bot (${signal})...`);
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
// Main Entry Point
// ============================================

async function main(): Promise<void> {
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

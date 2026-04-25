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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createInterface } from 'readline';
import { homedir } from 'os';
import { access as fsAccess } from 'node:fs/promises';
import path from 'path';
import { PyrforRuntime } from './index.js';
import { logger } from '../observability/logger.js';
import { loadConfig, DEFAULT_CONFIG_PATH } from './config.js';
import { createServiceManager } from './service.js';
import { transcribeTelegramVoice } from './voice.js';
import { discoverLegacyStores, migrateLegacyStore } from './migrate-sessions.js';
import { exportTrajectoriesToFile } from './export-cli.js';
import { isAllowedChat, createRateLimiter, handleStatus, handleProjects, handleTasks, handleAddTask, handleAi, handleMorningBrief, } from './telegram/handlers.js';
import { approvalFlow } from './approval-flow.js';
import { LiveActivity } from './telegram/live-activity.js';
import { getTelegramWebAppUrl } from './telegram/webapp.js';
import { GoalStore } from './goal-store.js';
import { mkdirSync, writeFileSync as writeFS } from 'fs';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
/**
 * Best-effort lookup of a binary on PATH. Returns the absolute path if found,
 * otherwise null. Never throws.
 */
function findBinary(name) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { stdout } = yield execFileAsync('which', [name]);
            const resolved = stdout.toString().trim();
            return resolved.length > 0 ? resolved : null;
        }
        catch (_a) {
            return null;
        }
    });
}
// ============================================
// Defaults
// ============================================
/** Default workspace path: ~/.openclaw/workspace (SOUL.md/IDENTITY.md/MEMORY.md). */
const DEFAULT_WORKSPACE_PATH = path.join(homedir(), '.openclaw', 'workspace');
// ============================================
// Argument Parser
// ============================================
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        mode: 'daemon',
        help: false,
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        // Support --port=N and --port N
        if (arg === '--port' || arg.startsWith('--port=')) {
            const raw = arg.startsWith('--port=') ? arg.slice('--port='.length) : args[++i];
            const parsed = parseInt(raw !== null && raw !== void 0 ? raw : '', 10);
            if (isNaN(parsed) || parsed < 0) {
                // eslint-disable-next-line no-console
                console.error(`Error: --port must be a non-negative integer (got "${raw}")`);
                process.exit(1);
            }
            options.gatewayPort = parsed;
            continue;
        }
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
function showHelp() {
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
  --port=N            Gateway bind port (0 = OS-assigned random; default: 18790).
                      When the server is ready it prints LISTENING_ON=<port> to stdout.
  --help, -h          Show this help

Service Commands:
  service install     Install as OS service (LaunchAgent on macOS, systemd user unit on Linux)
  service uninstall   Remove OS service and disable autostart
  service status      Print service status as JSON

  Install options:
    --env-file <path>   Path to .env file (default: .env in cwd if it exists)
    --exec <path>       Path to executable (default: current node process)
    --workdir <dir>     Working directory (default: cwd)

Tunnel Command:
  tunnel              Expose the runtime gateway over HTTPS via ngrok or cloudflared
    --port <number>     Override port (default: config.gateway.port, fallback 18790)
    --provider <name>   Force 'ngrok' or 'cloudflared' (otherwise auto-detect)
    --config <path>     Custom config path

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
function runDaemon(runtime) {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info('Running in daemon mode');
        // Runtime is already started, just keep alive
        // Could add health check server here
        // Keep process alive
        process.on('SIGINT', () => __awaiter(this, void 0, void 0, function* () {
            logger.info('Shutting down...');
            yield runtime.stop();
            process.exit(0);
        }));
        process.on('SIGTERM', () => __awaiter(this, void 0, void 0, function* () {
            logger.info('Shutting down...');
            yield runtime.stop();
            process.exit(0);
        }));
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
    });
}
/**
 * Interactive chat mode
 */
function runChat(runtime, options) {
    return __awaiter(this, void 0, void 0, function* () {
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
        const askQuestion = () => {
            rl.question('You: ', (input) => __awaiter(this, void 0, void 0, function* () {
                if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
                    rl.close();
                    yield runtime.stop();
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
                const result = yield runtime.handleMessage('cli', userId, chatId, input, {
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
                }
                else {
                    // eslint-disable-next-line no-console
                    console.error(`\n❌ Error: ${result.error}\n`);
                }
                askQuestion();
            }));
        };
        askQuestion();
    });
}
/**
 * Telegram bot mode
 */
function runTelegram(runtime) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        logger.info('Running in Telegram bot mode');
        // Token: prefer config, fall back to env
        const tgConfig = runtime.config.telegram;
        const token = (_a = tgConfig.botToken) !== null && _a !== void 0 ? _a : process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            logger.error('TELEGRAM_BOT_TOKEN not set');
            // eslint-disable-next-line no-console
            console.error('Error: set TELEGRAM_BOT_TOKEN env var or telegram.botToken in runtime.json');
            process.exit(1);
        }
        // ── Mini App static gateway ──────────────────────────────────────────────
        // When TELEGRAM_WEBAPP_URL is configured, the Telegram bot exposes a Web App
        // (Mini App) menu button. The Mini App's static assets (index.html, app.js,
        // style.css from packages/engine/src/runtime/telegram/app/) need to be
        // served over HTTP — by default that is the runtime gateway on
        // config.gateway.port (18790). Daemon mode starts the gateway via
        // config.gateway.enabled, but --telegram mode historically did not. Force
        // the gateway up here so the Mini App actually loads.
        const miniAppUrl = getTelegramWebAppUrl();
        if (miniAppUrl) {
            try {
                const handle = yield runtime.ensureGatewayStarted();
                if (handle) {
                    logger.info('[telegram] HTTP gateway started for Mini App static files', {
                        port: handle.port,
                        miniAppUrl,
                    });
                }
                else {
                    logger.warn('[telegram] HTTP gateway could not be started — Mini App static files will not be served');
                }
            }
            catch (err) {
                logger.warn('[telegram] Failed to start HTTP gateway for Mini App', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        // Lazy-load grammY so users without --telegram don't pay for it
        let grammyMod;
        let runnerMod;
        try {
            grammyMod = yield import('grammy');
            runnerMod = yield import('@grammyjs/runner');
        }
        catch (err) {
            logger.error('grammY not installed', { error: String(err) });
            // eslint-disable-next-line no-console
            console.error('Error: grammy and @grammyjs/runner are required. Install with: npm install grammy @grammyjs/runner');
            process.exit(1);
            return;
        }
        const { Bot, session } = grammyMod;
        const { run, sequentialize } = runnerMod;
        const bot = new Bot(token);
        const goalStore = new GoalStore();
        // ── Adapter: expose grammY bot as TelegramSender for runtime/tools ──────
        const sender = {
            sendMessage(chatId, text, options) {
                return __awaiter(this, void 0, void 0, function* () {
                    const cid = typeof chatId === 'string' ? Number(chatId) || chatId : chatId;
                    try {
                        return yield bot.api.sendMessage(cid, text, {
                            parse_mode: options === null || options === void 0 ? void 0 : options.parse_mode,
                        });
                    }
                    catch (_a) {
                        // Fallback to plain text if Markdown/HTML parsing fails
                        return yield bot.api.sendMessage(cid, text);
                    }
                });
            },
        };
        runtime.setTelegramBot(sender);
        // ── Update deduplication (OpenClaw pattern) ─────────────────────────────
        const seenUpdates = new Set();
        const updateQueue = [];
        const isDuplicate = (id) => {
            if (seenUpdates.has(id))
                return true;
            seenUpdates.add(id);
            updateQueue.push(id);
            while (updateQueue.length > 200) {
                const old = updateQueue.shift();
                if (old !== undefined)
                    seenUpdates.delete(old);
            }
            return false;
        };
        bot.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
            if (ctx.update.update_id && isDuplicate(ctx.update.update_id)) {
                logger.debug('Duplicate update skipped', { updateId: ctx.update.update_id });
                return;
            }
            yield next();
        }));
        // ── Per-chat sequencing: messages from same chat processed in order ────
        bot.use(sequentialize((ctx) => { var _a; return (((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) ? `chat:${ctx.chat.id}` : undefined); }));
        // ── Session middleware ─────────────────────────────────────────────────
        bot.use(session({ initial: () => ({}) }));
        // ── ACL: only allow configured chat IDs (empty = open) ────────────────
        const numericAllowedChatIds = tgConfig.allowedChatIds
            .map((id) => (typeof id === 'string' ? parseInt(id, 10) : id))
            .filter((id) => !isNaN(id));
        bot.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const chatId = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id;
            if (chatId !== undefined && !isAllowedChat(chatId, numericAllowedChatIds)) {
                logger.debug('[telegram] Chat not in allowedChatIds, ignoring', { chatId });
                return;
            }
            return next();
        }));
        // ── Rate limit from config (per-minute sliding window) ────────────────
        const rateLimiter = createRateLimiter(tgConfig.rateLimitPerMinute);
        bot.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            if (!ctx.message)
                return next();
            const chatId = (_b = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 0;
            if (!rateLimiter.allow(chatId)) {
                yield ctx.reply('⏳ Слишком много запросов. Подождите минуту.').catch(() => { });
                return;
            }
            return next();
        }));
        // ── Long-message helper with Markdown → plain text fallback ──────────
        const MAX_LEN = 4000;
        function replyChunked(ctx, text) {
            return __awaiter(this, void 0, void 0, function* () {
                let rest = text;
                while (rest.length > 0) {
                    const chunk = rest.slice(0, MAX_LEN);
                    rest = rest.slice(MAX_LEN);
                    try {
                        yield ctx.reply(chunk, { parse_mode: 'Markdown' });
                    }
                    catch (_a) {
                        try {
                            yield ctx.reply(chunk);
                        }
                        catch (err) {
                            logger.error('Failed to send Telegram chunk', { error: String(err) });
                        }
                    }
                }
            });
        }
        // ── Progress event formatter ──────────────────────────────────────────────
        function formatProgress(event) {
            switch (event.kind) {
                case 'tool-start': return `🔧 ${event.summary}`;
                case 'tool-end': return event.ok ? `✅ ${event.name} (${event.ms}ms)` : `❌ ${event.name}`;
                case 'llm-start': return `🧠 ${event.model}…`;
                case 'llm-end': return `🧠 ${event.model} (${event.ms}ms)`;
                case 'compact': return `📦 Сжимаю контекст (${event.tokensBefore} → ${event.tokensAfter})`;
            }
        }
        function safeReact(ctx, emoji) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                try {
                    const cid = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id;
                    const mid = (_b = ctx.message) === null || _b === void 0 ? void 0 : _b.message_id;
                    if (cid === undefined || mid === undefined)
                        return;
                    yield bot.api.setMessageReaction(Number(cid), mid, [
                        { type: 'emoji', emoji },
                    ]);
                }
                catch (err) {
                    // Reactions are non-critical: bot may lack permission, emoji may not be in the
                    // chat's allowed reaction set, or REACTION_INVALID for some chat types. Log at
                    // debug level instead of warn so production logs aren't spammed.
                    logger.debug('[telegram] setMessageReaction skipped', { emoji, error: String(err) });
                }
            });
        }
        // ── Commands ────────────────────────────────────────────────────────────
        // Set chat menu button for a single chat (best-effort, HTTPS required in production)
        function setMiniAppMenuButton(chatId) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!miniAppUrl)
                    return;
                try {
                    yield bot.api.raw.setChatMenuButton({
                        chat_id: chatId,
                        menu_button: { type: 'web_app', text: '🐾 Pyrfor', web_app: { url: miniAppUrl } },
                    });
                }
                catch (err) {
                    logger.warn('[telegram] setChatMenuButton failed (HTTPS required for web_app URLs in production)', {
                        chatId, url: miniAppUrl, error: String(err),
                    });
                }
            });
        }
        bot.command('start', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const chatId = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id;
            if (miniAppUrl) {
                yield ctx.reply('👋 Привет! Я Pyrfor — твой AI-ассистент.\n\nНапиши мне сообщение или открой приложение 👇', {
                    reply_markup: {
                        inline_keyboard: [[
                                { text: '🐾 Открыть Pyrfor', web_app: { url: miniAppUrl } },
                            ]],
                    },
                });
            }
            else {
                yield ctx.reply('👋 Привет! Я Pyrfor — твой AI-ассистент.\n\nНапиши мне сообщение, чтобы начать.');
            }
            // Set menu button for this chat so the app is one tap away
            if (chatId !== undefined && miniAppUrl) {
                yield setMiniAppMenuButton(chatId);
            }
        }));
        bot.command('help', (ctx) => __awaiter(this, void 0, void 0, function* () {
            yield ctx.reply(`🤖 *Pyrfor — команды*\n\n` +
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
                `📷 Фото и 📄 документы (.txt/.md/.csv/.json) обрабатываются автоматически.`, { parse_mode: 'Markdown' });
        }));
        // /status — PM-style project/task overview (requires Prisma)
        bot.command('status', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const chatId = (_b = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 0;
            const text = (_d = (_c = ctx.message) === null || _c === void 0 ? void 0 : _c.text) !== null && _d !== void 0 ? _d : '';
            const params = text.split(' ').slice(1);
            try {
                const reply = yield handleStatus({ chatId, text, params });
                yield replyChunked(ctx, reply);
            }
            catch (err) {
                logger.warn('[telegram] /status failed (Prisma not configured?)', { error: String(err) });
                yield ctx.reply('⚠️ Команда недоступна: база данных не подключена.');
            }
        }));
        // /projects — project list (requires Prisma)
        bot.command('projects', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const chatId = (_b = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 0;
            const text = (_d = (_c = ctx.message) === null || _c === void 0 ? void 0 : _c.text) !== null && _d !== void 0 ? _d : '';
            const params = text.split(' ').slice(1);
            try {
                const reply = yield handleProjects({ chatId, text, params });
                yield replyChunked(ctx, reply);
            }
            catch (err) {
                logger.warn('[telegram] /projects failed (Prisma not configured?)', { error: String(err) });
                yield ctx.reply('⚠️ Команда недоступна: база данных не подключена.');
            }
        }));
        // /tasks — open task list (requires Prisma)
        bot.command('tasks', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const chatId = (_b = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 0;
            const text = (_d = (_c = ctx.message) === null || _c === void 0 ? void 0 : _c.text) !== null && _d !== void 0 ? _d : '';
            const params = text.split(' ').slice(1);
            try {
                const reply = yield handleTasks({ chatId, text, params });
                yield replyChunked(ctx, reply);
            }
            catch (err) {
                logger.warn('[telegram] /tasks failed (Prisma not configured?)', { error: String(err) });
                yield ctx.reply('⚠️ Команда недоступна: база данных не подключена.');
            }
        }));
        // /add_task <project> <title> (requires Prisma)
        bot.command('add_task', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const chatId = (_b = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 0;
            const text = (_d = (_c = ctx.message) === null || _c === void 0 ? void 0 : _c.text) !== null && _d !== void 0 ? _d : '';
            const params = text.split(' ').slice(1);
            try {
                const reply = yield handleAddTask({ chatId, text, params });
                yield replyChunked(ctx, reply);
            }
            catch (err) {
                logger.warn('[telegram] /add_task failed (Prisma not configured?)', { error: String(err) });
                yield ctx.reply('⚠️ Команда недоступна: база данных не подключена.');
            }
        }));
        // /ai <query> — direct AI query via runtime
        bot.command('ai', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            const chatId = (_b = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 0;
            const userId = String((_d = (_c = ctx.from) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : 'unknown');
            const text = (_f = (_e = ctx.message) === null || _e === void 0 ? void 0 : _e.text) !== null && _f !== void 0 ? _f : '';
            const params = text.split(' ').slice(1);
            yield ctx.replyWithChatAction('typing').catch(() => { });
            const runMessage = (query) => __awaiter(this, void 0, void 0, function* () {
                const result = yield runtime.handleMessage('telegram', userId, String(chatId), query);
                return result.response || result.error || 'Нет ответа.';
            });
            try {
                const reply = yield handleAi({ chatId, text, params }, runMessage);
                yield replyChunked(ctx, reply);
            }
            catch (err) {
                logger.error('[telegram] /ai failed', { error: String(err) });
                yield ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`);
            }
        }));
        // /brief — morning briefing (requires Prisma)
        bot.command('brief', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const chatId = (_b = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 0;
            const text = (_d = (_c = ctx.message) === null || _c === void 0 ? void 0 : _c.text) !== null && _d !== void 0 ? _d : '';
            const params = text.split(' ').slice(1);
            try {
                const reply = yield handleMorningBrief({ chatId, text, params });
                yield replyChunked(ctx, reply);
            }
            catch (err) {
                logger.warn('[telegram] /brief failed (Prisma not configured?)', { error: String(err) });
                yield ctx.reply('⚠️ Команда недоступна: база данных не подключена.');
            }
        }));
        // ── Goal commands ─────────────────────────────────────────────────────
        bot.command('goals', (ctx) => __awaiter(this, void 0, void 0, function* () {
            const goals = goalStore.list('active');
            if (goals.length === 0) {
                yield ctx.reply('🎯 Активных целей нет.\n\nИспользуй `/newgoal <описание>` для создания.', { parse_mode: 'Markdown' });
                return;
            }
            let text = '🎯 *Активные цели:*\n\n';
            goals.forEach((g, i) => {
                text += `${i + 1}. ⏳ ${g.description}\n   ID: \`${g.id}\`\n\n`;
            });
            text += 'Используй /progress для деталей.';
            yield replyChunked(ctx, text);
        }));
        bot.command('progress', (ctx) => __awaiter(this, void 0, void 0, function* () {
            const goals = goalStore.list('active');
            const goal = goals[goals.length - 1];
            if (!goal) {
                yield ctx.reply('ℹ️ Нет активных целей.');
                return;
            }
            const text = `🎯 *Текущая цель*\n\n` +
                `*ID:* \`${goal.id}\`\n` +
                `*Статус:* ⏳ active\n` +
                `*Описание:* ${goal.description}\n` +
                `*Создана:* ${new Date(goal.createdAt).toLocaleString('ru-RU')}`;
            yield replyChunked(ctx, text);
        }));
        bot.command('newgoal', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const text = (_b = (_a = ctx.message) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : '';
            const description = text.split(' ').slice(1).join(' ').trim();
            if (!description) {
                yield ctx.reply('⚠️ Укажи описание цели: `/newgoal <описание>`', { parse_mode: 'Markdown' });
                return;
            }
            const goal = goalStore.create(description);
            yield ctx.reply(`✅ Цель создана!\n\n*ID:* \`${goal.id}\`\n*Описание:* ${description}`, { parse_mode: 'Markdown' });
        }));
        bot.command('done', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const text = (_b = (_a = ctx.message) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : '';
            const id = (_c = text.split(' ')[1]) === null || _c === void 0 ? void 0 : _c.trim();
            if (!id) {
                yield ctx.reply('⚠️ Укажи ID цели: `/done <id>`', { parse_mode: 'Markdown' });
                return;
            }
            const goal = goalStore.markDone(id);
            if (!goal) {
                yield ctx.reply(`❌ Цель с ID \`${id}\` не найдена.`, { parse_mode: 'Markdown' });
                return;
            }
            yield ctx.reply(`✅ Цель завершена: ${goal.description}`, { parse_mode: 'Markdown' });
        }));
        bot.command('cancel', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const text = (_b = (_a = ctx.message) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : '';
            const id = (_c = text.split(' ')[1]) === null || _c === void 0 ? void 0 : _c.trim();
            if (!id) {
                yield ctx.reply('⚠️ Укажи ID цели: `/cancel <id>`', { parse_mode: 'Markdown' });
                return;
            }
            const goal = goalStore.cancel(id);
            if (!goal) {
                yield ctx.reply(`❌ Цель с ID \`${id}\` не найдена.`, { parse_mode: 'Markdown' });
                return;
            }
            yield ctx.reply(`🚫 Цель отменена: ${goal.description}`);
        }));
        bot.command('stats', (ctx) => __awaiter(this, void 0, void 0, function* () {
            const stats = runtime.getStats();
            const text = `📈 *Подробная статистика*\n\n` +
                `*Sessions*\n` +
                `• Active: ${stats.sessions.active}\n` +
                `• Tokens: ${stats.sessions.totalTokens}\n\n` +
                `*Providers*\n` +
                `• Available: ${stats.providers.available.join(', ') || 'none'}\n` +
                `• Cost USD: ${stats.providers.costs.totalUsd.toFixed(4)}\n\n` +
                `*Workspace*\n` +
                `• Loaded: ${stats.workspace.loaded ? '✅' : '❌'}`;
            yield ctx.reply(text, { parse_mode: 'Markdown' });
        }));
        bot.command('clear', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const chatId = String((_b = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : '');
            const userId = String((_d = (_c = ctx.from) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : 'unknown');
            const cleared = runtime.clearSession('telegram', userId, chatId);
            yield ctx.reply(cleared ? '🧹 Контекст диалога сброшен.' : 'ℹ️ Активной сессии нет.');
        }));
        // ── Active pipelines registry (A3 typing refresh + A7 /stop + A11 cancel) ──
        const activePipelines = new Map();
        let isShuttingDown = false;
        const runWithTypingAndStop = (ctx, work) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const chatId = String((_b = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : '');
            if (isShuttingDown) {
                yield ctx.reply('⏸ Бот выключается, попробуй позже.').catch(() => { });
                return;
            }
            const existing = activePipelines.get(chatId);
            if (existing) {
                existing.abort();
            }
            const controller = new AbortController();
            activePipelines.set(chatId, controller);
            yield ctx.replyWithChatAction('typing').catch(() => { });
            const refreshInterval = setInterval(() => {
                void ctx.replyWithChatAction('typing').catch(() => { });
            }, 4000);
            try {
                yield work(controller.signal);
            }
            catch (err) {
                if (controller.signal.aborted) {
                    logger.info('Pipeline aborted', { chatId });
                }
                else {
                    logger.error('Pipeline failed', { chatId, error: String(err) });
                    yield ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`).catch(() => { });
                }
            }
            finally {
                clearInterval(refreshInterval);
                if (activePipelines.get(chatId) === controller)
                    activePipelines.delete(chatId);
            }
        });
        bot.command('stop', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const chatId = String((_b = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : '');
            const ctrl = activePipelines.get(chatId);
            if (ctrl) {
                ctrl.abort();
                activePipelines.delete(chatId);
                yield ctx.reply('🛑 Текущий запрос остановлен.');
            }
            else {
                yield ctx.reply('ℹ️ Активного запроса нет.');
            }
        }));
        // ── Voice handler (uses runtime/voice module) ──────────────────────────
        bot.on('message:voice', (ctx) => __awaiter(this, void 0, void 0, function* () {
            const voice = ctx.message.voice;
            if (!voice)
                return;
            yield safeReact(ctx, '👀');
            yield runWithTypingAndStop(ctx, (signal) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c;
                let transcribedText;
                try {
                    transcribedText = yield transcribeTelegramVoice({
                        botToken: token,
                        fileId: voice.file_id,
                        voiceConfig: runtime.config.voice,
                    });
                }
                catch (err) {
                    logger.error('Voice transcription failed', { error: String(err) });
                    yield safeReact(ctx, '❌');
                    yield ctx.reply('❌ Не удалось распознать голос. Попробуй текстом.');
                    return;
                }
                if (signal.aborted)
                    return;
                if (!transcribedText.trim()) {
                    yield ctx.reply('🤷 Не услышал слов. Попробуй ещё раз.');
                    return;
                }
                yield ctx.reply(`🎤 _${transcribedText}_`, { parse_mode: 'Markdown' }).catch(() => { });
                const chatId = String(ctx.chat.id);
                const userId = String((_b = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 'unknown');
                const result = yield runtime.handleMessage('telegram', userId, chatId, transcribedText);
                if (signal.aborted)
                    return;
                if (result.success) {
                    yield safeReact(ctx, '✅');
                    yield replyChunked(ctx, result.response);
                }
                else {
                    yield safeReact(ctx, '❌');
                    yield ctx.reply(`❌ Ошибка: ${(_c = result.error) !== null && _c !== void 0 ? _c : 'unknown'}`);
                }
            }));
        }));
        // ── Photo handler ─────────────────────────────────────────────────────────
        bot.on('message:photo', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e;
            yield safeReact(ctx, '👀');
            const photos = ctx.message.photo;
            const photo = photos[photos.length - 1];
            if (!photo)
                return;
            try {
                const file = yield ctx.api.getFile(photo.file_id);
                const filePath = file.file_path;
                const fileUrl = filePath
                    ? `https://api.telegram.org/file/bot${token}/${filePath}`
                    : null;
                const modelName = (_b = (_a = runtime.config.providers) === null || _a === void 0 ? void 0 : _a.defaultProvider) !== null && _b !== void 0 ? _b : '';
                const supportsVision = /gpt-4o|claude|gemini|glm-4v|qwen-vl/i.test(String(modelName));
                if (supportsVision && fileUrl) {
                    // TODO: Pass image URL to handleMessage for vision processing
                    const chatId = String(ctx.chat.id);
                    const userId = String((_d = (_c = ctx.from) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : 'unknown');
                    const prompt = `[Описание прикреплённого фото: ${fileUrl}]\n${(_e = ctx.message.caption) !== null && _e !== void 0 ? _e : 'Опиши это фото'}`;
                    yield runWithTypingAndStop(ctx, (signal) => __awaiter(this, void 0, void 0, function* () {
                        var _a;
                        const result = yield runtime.handleMessage('telegram', userId, chatId, prompt);
                        if (signal.aborted)
                            return;
                        if (result.success) {
                            yield safeReact(ctx, '✅');
                            yield replyChunked(ctx, result.response);
                        }
                        else {
                            yield safeReact(ctx, '❌');
                            yield ctx.reply(`❌ Ошибка: ${(_a = result.error) !== null && _a !== void 0 ? _a : 'unknown'}`);
                        }
                    }));
                }
                else {
                    yield safeReact(ctx, '✅');
                    yield ctx.reply(`📷 Фото получено${fileUrl ? '' : ' (файл недоступен)'}.\n` +
                        `⚠️ Текущая модель (${modelName || 'default'}) не поддерживает vision.\n` +
                        `Переключитесь на gpt-4o, claude, или gemini для анализа фото.\n` +
                        `// TODO: vision integration`);
                }
            }
            catch (err) {
                logger.error('[telegram] Photo handler failed', { error: String(err) });
                yield safeReact(ctx, '❌');
                yield ctx.reply(`❌ Ошибка при обработке фото: ${err instanceof Error ? err.message : String(err)}`).catch(() => { });
            }
        }));
        // ── Document handler ───────────────────────────────────────────────────────
        bot.on('message:document', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            yield safeReact(ctx, '👀');
            const doc = ctx.message.document;
            if (!doc)
                return;
            const MAX_DOC_SIZE = 10 * 1024 * 1024;
            if (doc.file_size && doc.file_size > MAX_DOC_SIZE) {
                yield safeReact(ctx, '❌');
                yield ctx.reply(`❌ Файл слишком большой (${Math.round(doc.file_size / 1024 / 1024)}MB). Максимум: 10MB.`);
                return;
            }
            const name = (_a = doc.file_name) !== null && _a !== void 0 ? _a : `file_${doc.file_id}`;
            const ext = path.extname(name).toLowerCase();
            const textLike = ['.txt', '.md', '.csv', '.json', '.ts', '.js', '.py', '.yaml', '.yml', '.toml'];
            try {
                const file = yield ctx.api.getFile(doc.file_id);
                const filePath = file.file_path;
                if (!filePath) {
                    yield safeReact(ctx, '❌');
                    yield ctx.reply('❌ Не удалось получить ссылку на файл.');
                    return;
                }
                const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
                const inboxDir = path.join(homedir(), '.pyrfor', 'inbox');
                mkdirSync(inboxDir, { recursive: true });
                const savePath = path.join(inboxDir, name);
                const resp = yield fetch(fileUrl);
                if (!resp.ok)
                    throw new Error(`HTTP ${resp.status}`);
                const buffer = Buffer.from(yield resp.arrayBuffer());
                writeFS(savePath, buffer);
                if (textLike.includes(ext)) {
                    const content = buffer.toString('utf-8');
                    const chatId = String(ctx.chat.id);
                    const userId = String((_c = (_b = ctx.from) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : 'unknown');
                    const prompt = `[Содержимое файла ${name}]\n${content}`;
                    yield runWithTypingAndStop(ctx, (signal) => __awaiter(this, void 0, void 0, function* () {
                        var _a;
                        const result = yield runtime.handleMessage('telegram', userId, chatId, prompt);
                        if (signal.aborted)
                            return;
                        if (result.success) {
                            yield safeReact(ctx, '✅');
                            yield replyChunked(ctx, result.response);
                        }
                        else {
                            yield safeReact(ctx, '❌');
                            yield ctx.reply(`❌ Ошибка: ${(_a = result.error) !== null && _a !== void 0 ? _a : 'unknown'}`);
                        }
                    }));
                }
                else {
                    // TODO: MarkItDown integration for PDF/DOCX/XLSX parsing
                    yield safeReact(ctx, '✅');
                    yield ctx.reply(`📄 Документ сохранён: ~/.pyrfor/inbox/${name}\n` +
                        `(PDF/Office parsing будет в следующей итерации)`);
                }
            }
            catch (err) {
                logger.error('[telegram] Document handler failed', { error: String(err) });
                yield safeReact(ctx, '❌');
                yield ctx.reply(`❌ Ошибка при обработке документа: ${err instanceof Error ? err.message : String(err)}`).catch(() => { });
            }
        }));
        // ── Text handler ───────────────────────────────────────────────────────
        bot.on('message:text', (ctx) => __awaiter(this, void 0, void 0, function* () {
            const text = ctx.message.text;
            if (text.startsWith('/'))
                return; // commands handled above
            yield safeReact(ctx, '👀');
            yield runWithTypingAndStop(ctx, (signal) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c;
                const chatId = String(ctx.chat.id);
                const userId = String((_b = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 'unknown');
                const live = new LiveActivity(bot, ctx.chat.id);
                yield live.start('⚙️ Работаю...');
                const progressLines = [];
                try {
                    const result = yield runtime.handleMessage('telegram', userId, chatId, text, {
                        onProgress: (event) => {
                            const line = formatProgress(event);
                            progressLines.push(line);
                            const display = progressLines.slice(-10).join('\n');
                            void live.update(`⚙️ Работаю...\n\n${display}`).catch(() => { });
                        },
                    });
                    if (signal.aborted)
                        return;
                    if (result.success) {
                        yield live.complete(`✅ Готово`, 60000);
                        yield safeReact(ctx, '✅');
                        yield replyChunked(ctx, result.response);
                    }
                    else {
                        yield live.complete(`❌ Ошибка`);
                        yield safeReact(ctx, '❌');
                        yield ctx.reply(`❌ Ошибка: ${(_c = result.error) !== null && _c !== void 0 ? _c : 'unknown'}`);
                    }
                }
                catch (err) {
                    yield live.complete(`❌ Ошибка`, 30000);
                    yield safeReact(ctx, '❌');
                    throw err;
                }
            }));
        }));
        // ── Approval flow: inline keyboard for dangerous tool calls ──────────────
        // Determine the admin chat ID for approval prompts
        const approvalAdminChatId = tgConfig.adminChatId !== undefined
            ? Number(tgConfig.adminChatId)
            : numericAllowedChatIds[0];
        approvalFlow.events.on('approval-requested', (req) => __awaiter(this, void 0, void 0, function* () {
            if (approvalAdminChatId === undefined || isNaN(approvalAdminChatId)) {
                logger.warn('Approval requested but no admin chat ID configured — tool will wait for TTL', {
                    toolName: req.toolName,
                    id: req.id,
                });
                return;
            }
            try {
                yield bot.api.sendMessage(approvalAdminChatId, `⚠️ Подтвердите действие:\n\n\`${req.summary}\``, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Разрешить', callback_data: `approve:${req.id}` },
                                { text: '❌ Отклонить', callback_data: `deny:${req.id}` },
                            ],
                        ],
                    },
                });
            }
            catch (err) {
                logger.error('Failed to send approval prompt via Telegram', {
                    error: String(err),
                    toolName: req.toolName,
                    id: req.id,
                });
            }
        }));
        // ── Approval callback handler ──────────────────────────────────────────
        bot.on('callback_query:data', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const data = ctx.callbackQuery.data;
            if (!data)
                return;
            if (data.startsWith('approve:') || data.startsWith('deny:')) {
                const decision = data.startsWith('approve:') ? 'approve' : 'deny';
                const id = data.startsWith('approve:') ? data.slice(8) : data.slice(5);
                approvalFlow.resolveDecision(id, decision);
                const label = decision === 'approve' ? '✅ Разрешено' : '❌ Отклонено';
                yield ctx.answerCallbackQuery({ text: label }).catch(() => { });
                // Edit the original message to remove inline keyboard and append decision
                try {
                    const msg = ctx.callbackQuery.message;
                    if (msg) {
                        const originalText = 'text' in msg ? ((_a = msg.text) !== null && _a !== void 0 ? _a : '') : '';
                        yield ctx.api.editMessageText(msg.chat.id, msg.message_id, `${originalText}\n\n${label}`, { reply_markup: { inline_keyboard: [] } });
                    }
                }
                catch (_b) {
                    // Ignore edit failures (e.g. message too old)
                }
                return;
            }
            // Other callback_query:data handlers can be added here or before this block
        }));
        // ── Global error handler ────────────────────────────────────────────────
        bot.catch((err) => {
            var _a, _b;
            logger.error('grammY bot error', {
                error: err.error instanceof Error ? err.error.message : String(err.error),
                updateId: (_b = (_a = err.ctx) === null || _a === void 0 ? void 0 : _a.update) === null || _b === void 0 ? void 0 : _b.update_id,
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
        const shutdown = (signal) => __awaiter(this, void 0, void 0, function* () {
            if (isShuttingDown)
                return;
            isShuttingDown = true;
            logger.info(`Shutting down Telegram bot (${signal})...`);
            // A11: cancel active subagent pipelines first.
            for (const [chatId, ctrl] of activePipelines) {
                try {
                    ctrl.abort();
                }
                catch ( /* ignore */_a) { /* ignore */ }
                logger.info('Aborted active pipeline on shutdown', { chatId });
            }
            // A10: drain in-flight handlers (give them up to 5s to settle).
            const drainStart = Date.now();
            while (activePipelines.size > 0 && Date.now() - drainStart < 5000) {
                yield new Promise((r) => setTimeout(r, 100));
            }
            if (activePipelines.size > 0) {
                logger.warn('Drain timeout; abandoning in-flight pipelines', { count: activePipelines.size });
            }
            try {
                yield runner.stop();
            }
            catch (err) {
                logger.warn('Runner stop failed', { error: String(err) });
            }
            try {
                yield runtime.stop();
            }
            catch (err) {
                logger.warn('Runtime stop failed', { error: String(err) });
            }
            process.exit(0);
        });
        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));
        // Keep running until runner stops
        yield runner.task();
    });
}
/**
 * One-shot mode
 */
function runOnce(runtime, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const message = options.message;
        if (!message) {
            // eslint-disable-next-line no-console
            console.error('Error: Message required. Use --once "your question"');
            process.exit(1);
        }
        logger.info('Running in one-shot mode', { message: message.slice(0, 100) });
        const result = yield runtime.handleMessage('cli', 'cli-user', 'cli-chat', message, {
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
        }
        else {
            // eslint-disable-next-line no-console
            console.error(`Error: ${result.error}`);
            process.exit(1);
        }
        yield runtime.stop();
        process.exit(0);
    });
}
// ============================================
// Service Subcommands
// ============================================
/**
 * Handles `service install|uninstall|status` — bypasses normal runtime startup.
 */
function runService(args) {
    return __awaiter(this, void 0, void 0, function* () {
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
            let envFile;
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
                    yield fsAccess(defaultEnv);
                    envFile = defaultEnv;
                }
                catch (_a) {
                    // no .env in cwd — leave undefined
                }
            }
            const manager = createServiceManager({ workingDir: workdir });
            const scriptPath = process.argv[1];
            yield manager.install({ envFile, executablePath, args: [scriptPath, '--telegram'] });
            // eslint-disable-next-line no-console
            console.log('Installed dev.pyrfor.runtime — autostart enabled.');
            // Hint the user toward a tunnel for exposing the Mini App over HTTPS.
            const ngrokPath = yield findBinary('ngrok');
            if (ngrokPath) {
                // eslint-disable-next-line no-console
                console.log(`💡 ngrok detected. To expose the Mini App over HTTPS:
     pyrfor-runtime tunnel
   Then set TELEGRAM_WEBAPP_URL in your .env and reinstall the service.`);
            }
            else {
                // eslint-disable-next-line no-console
                console.log(`💡 To expose the Mini App over HTTPS, install a tunnel:
     brew install ngrok    (recommended)
     brew install cloudflared
   Then run: pyrfor-runtime tunnel`);
            }
            process.exit(0);
        }
        if (subcommand === 'uninstall') {
            let workdir = cwd;
            for (let i = 1; i < args.length; i++) {
                if (args[i] === '--workdir')
                    workdir = args[++i];
            }
            const manager = createServiceManager({ workingDir: workdir });
            yield manager.uninstall();
            // eslint-disable-next-line no-console
            console.log('Uninstalled dev.pyrfor.runtime — service removed.');
            process.exit(0);
        }
        if (subcommand === 'status') {
            const manager = createServiceManager({ workingDir: cwd });
            const result = yield manager.status();
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        }
        // eslint-disable-next-line no-console
        console.error(`Unknown service subcommand: ${subcommand}`);
        // eslint-disable-next-line no-console
        console.error('Valid subcommands: install, uninstall, status');
        process.exit(1);
    });
}
// ============================================
// Migrate Subcommand
// ============================================
/**
 * Handles `migrate sessions [--dry-run] [--overwrite] [--from <path>] [--channel <name>]`
 */
function runMigrate(args) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
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
        const extraRoots = [];
        for (let i = 1; i < args.length; i++) {
            switch (args[i]) {
                case '--dry-run':
                    dryRun = true;
                    break;
                case '--overwrite':
                    overwrite = true;
                    break;
                case '--channel':
                    channel = (_a = args[++i]) !== null && _a !== void 0 ? _a : channel;
                    break;
                case '--from':
                    if (args[i + 1])
                        extraRoots.push(args[++i]);
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
        const stores = yield discoverLegacyStores(extraRoots.length > 0 ? extraRoots : undefined);
        if (stores.length === 0) {
            // eslint-disable-next-line no-console
            console.log('No legacy stores found. Nothing to migrate.');
            process.exit(0);
        }
        // eslint-disable-next-line no-console
        console.log(`Found ${stores.length} legacy file(s). Starting migration…\n`);
        let totalImported = 0;
        let totalSkipped = 0;
        const totalErrors = [];
        const totalFiles = [];
        for (const store of stores) {
            const report = yield migrateLegacyStore(store, {
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
    });
}
// ============================================
// Backup Subcommand
// ============================================
/**
 * Handles:
 *   pyrfor-runtime backup [--out <path>]
 *   pyrfor-runtime backup list
 */
function runBackup(args) {
    return __awaiter(this, void 0, void 0, function* () {
        const { createBackup, listBackups } = yield import('./backup.js');
        if (args[0] === 'list') {
            const entries = yield listBackups({});
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
        let outputPath;
        for (let i = 0; i < args.length; i++) {
            if ((args[i] === '--out' || args[i] === '-o') && args[i + 1]) {
                outputPath = args[++i];
            }
        }
        const result = yield createBackup({ outputPath });
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    });
}
// ============================================
// Restore Subcommand
// ============================================
/**
 * Handles: pyrfor-runtime restore <archive> [--force]
 */
function runRestore(args) {
    return __awaiter(this, void 0, void 0, function* () {
        const { restoreBackup } = yield import('./backup.js');
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
        const result = yield restoreBackup({ archivePath, force });
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    });
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
function runToken(args) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const { randomBytes } = yield import('crypto');
        const { saveConfig } = yield import('./config.js');
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
        let label;
        let ttlDays;
        let configPath;
        for (let i = 1; i < args.length; i++) {
            switch (args[i]) {
                case '--label':
                    label = args[++i];
                    break;
                case '--ttl-days':
                    ttlDays = parseInt((_a = args[++i]) !== null && _a !== void 0 ? _a : '', 10);
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
        const entry = { value: newToken };
        if (expiresAt)
            entry.expiresAt = expiresAt;
        if (label)
            entry.label = label;
        // Load config, append new token, save
        const resolvedConfigPath = configPath !== null && configPath !== void 0 ? configPath : DEFAULT_CONFIG_PATH;
        let saved = false;
        try {
            const { config } = yield loadConfig(resolvedConfigPath);
            const updated = Object.assign(Object.assign({}, config), { gateway: Object.assign(Object.assign({}, config.gateway), { bearerTokens: [...((_b = config.gateway.bearerTokens) !== null && _b !== void 0 ? _b : []), entry] }) });
            yield saveConfig(updated, resolvedConfigPath);
            saved = true;
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[token rotate] Could not auto-save config: ${err.message}`);
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
    });
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
export function parseSince(raw) {
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
export function runExportTrajectories(args) {
    return __awaiter(this, void 0, void 0, function* () {
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
        const opts = {
            format: 'sharegpt',
        };
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            // Support both --flag=value and --flag value styles
            const eqIdx = arg.indexOf('=');
            const key = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
            const eqVal = eqIdx !== -1 ? arg.slice(eqIdx + 1) : undefined;
            const nextVal = () => {
                if (eqVal !== undefined)
                    return eqVal;
                if (args[i + 1] !== undefined)
                    return args[++i];
                throw new Error(`Flag ${key} requires a value`);
            };
            switch (key) {
                case '--out':
                    opts.outPath = nextVal();
                    break;
                case '--format': {
                    const fmt = nextVal();
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
                    }
                    catch (err) {
                        process.stderr.write(`Error: ${err.message}\n`);
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
            const result = yield exportTrajectoriesToFile(opts);
            // eslint-disable-next-line no-console
            console.log(`✓ Exported ${result.exported} trajectories (${result.skipped} skipped) to ${result.outPath} (${result.bytes} bytes, format: ${result.formatUsed})`);
        }
        catch (err) {
            process.stderr.write(`Error: ${err.message}\n`);
            process.exit(1);
        }
    });
}
// ============================================
// Tunnel Subcommand
// ============================================
/**
 * Handler for `pyrfor-runtime tunnel [flags]`.
 *
 * Spawns an HTTPS tunnel (ngrok preferred, cloudflared fallback) pointing at
 * the runtime gateway and prints the discovered public URL so the user can
 * drop it into TELEGRAM_WEBAPP_URL.
 */
function runTunnelCommand(args) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        let port;
        let forcedProvider;
        let configPath;
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg === '--help' || arg === '-h') {
                // eslint-disable-next-line no-console
                console.log(`Usage: pyrfor-runtime tunnel [options]

Options:
  --port <number>     Override port (default: config.gateway.port, fallback 18790)
  --provider <name>   Force 'ngrok' or 'cloudflared' (otherwise auto-detect)
  --config <path>     Custom config path
  --help, -h          Show this help
`);
                process.exit(0);
            }
            else if (arg === '--port') {
                const raw = args[++i];
                const parsed = parseInt(raw, 10);
                if (isNaN(parsed) || parsed <= 0) {
                    // eslint-disable-next-line no-console
                    console.error(`Error: --port must be a positive integer (got "${raw}")`);
                    process.exit(1);
                }
                port = parsed;
            }
            else if (arg === '--provider') {
                const raw = args[++i];
                if (raw !== 'ngrok' && raw !== 'cloudflared') {
                    // eslint-disable-next-line no-console
                    console.error(`Error: --provider must be 'ngrok' or 'cloudflared' (got "${raw}")`);
                    process.exit(1);
                }
                forcedProvider = raw;
            }
            else if (arg === '--config') {
                configPath = args[++i];
            }
            else {
                // eslint-disable-next-line no-console
                console.error(`Error: Unknown flag: ${arg}`);
                process.exit(1);
            }
        }
        // Resolve port: CLI flag > config.gateway.port > 18790
        if (port === undefined) {
            const resolvedConfigPath = configPath !== null && configPath !== void 0 ? configPath : DEFAULT_CONFIG_PATH;
            const { config } = yield loadConfig(resolvedConfigPath).catch((err) => {
                logger.warn('[tunnel] Config load failed, using defaults', { error: String(err) });
                return { config: undefined };
            });
            port = (_b = (_a = config === null || config === void 0 ? void 0 : config.gateway) === null || _a === void 0 ? void 0 : _a.port) !== null && _b !== void 0 ? _b : 18790;
        }
        let provider;
        let bin;
        if (forcedProvider) {
            const resolved = yield findBinary(forcedProvider);
            if (!resolved) {
                // eslint-disable-next-line no-console
                console.error(`Error: --provider ${forcedProvider} requested but binary not found on PATH.`);
                process.exit(1);
            }
            provider = forcedProvider;
            bin = resolved;
        }
        else {
            const ngrokPath = yield findBinary('ngrok');
            if (ngrokPath) {
                provider = 'ngrok';
                bin = ngrokPath;
            }
            else {
                const cloudflaredPath = yield findBinary('cloudflared');
                if (cloudflaredPath) {
                    provider = 'cloudflared';
                    bin = cloudflaredPath;
                }
                else {
                    // eslint-disable-next-line no-console
                    console.error(`No tunnel binary found. Install one of:
  brew install ngrok    (recommended)
  brew install cloudflared`);
                    process.exit(1);
                }
            }
        }
        const spawnArgs = provider === 'ngrok'
            ? ['http', String(port), '--log=stdout', '--log-format=logfmt']
            : ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'];
        logger.info('[tunnel] starting', { provider, port, bin });
        const child = spawn(bin, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let urlFound = false;
        // ngrok logfmt url=... (may be quoted); also handle ngrok.io / ngrok.app / ngrok-free.app
        const ngrokRegex = /url=("?)(https:\/\/[^\s"]*ngrok(?:-free)?\.(?:app|io))\1/;
        // cloudflared advertises https://<random>.trycloudflare.com
        const cloudflaredRegex = /(https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com)/;
        const handleLine = (line) => {
            if (urlFound)
                return;
            let match = null;
            if (provider === 'ngrok') {
                match = line.match(ngrokRegex);
                if (match) {
                    urlFound = true;
                    const url = match[2];
                    // eslint-disable-next-line no-console
                    console.log(`✅ Tunnel ready: ${url}
Set this in your .env:
  TELEGRAM_WEBAPP_URL=${url}`);
                }
            }
            else {
                match = line.match(cloudflaredRegex);
                if (match) {
                    urlFound = true;
                    const url = match[1];
                    // eslint-disable-next-line no-console
                    console.log(`✅ Tunnel ready: ${url}
Set this in your .env:
  TELEGRAM_WEBAPP_URL=${url}`);
                }
            }
        };
        const wireStream = (stream) => {
            if (!stream)
                return;
            let buffer = '';
            stream.on('data', (chunk) => {
                const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
                // Mirror the child's output to our stderr so the user sees progress.
                process.stderr.write(text);
                buffer += text;
                let idx;
                while ((idx = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 1);
                    handleLine(line);
                }
            });
            stream.on('end', () => {
                if (buffer.length > 0)
                    handleLine(buffer);
            });
        };
        wireStream(child.stdout);
        wireStream(child.stderr);
        const forwardSignal = (signal) => {
            logger.info('[tunnel] received signal, shutting down', { signal });
            if (!child.killed) {
                try {
                    child.kill(signal);
                }
                catch (_a) {
                    // ignore
                }
            }
            process.exit(0);
        };
        process.on('SIGINT', () => forwardSignal('SIGINT'));
        process.on('SIGTERM', () => forwardSignal('SIGTERM'));
        child.on('exit', (code, signal) => {
            logger.info('[tunnel] child exited', { code, signal });
            process.exit(code !== null && code !== void 0 ? code : 0);
        });
        child.on('error', (err) => {
            // eslint-disable-next-line no-console
            console.error(`Error launching ${provider}: ${err.message}`);
            process.exit(1);
        });
    });
}
// ============================================
// Main Entry Point
// ============================================
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        // Service subcommands bypass normal runtime startup
        if (process.argv[2] === 'service') {
            yield runService(process.argv.slice(3));
            return;
        }
        // Migrate subcommands bypass normal runtime startup
        if (process.argv[2] === 'migrate') {
            yield runMigrate(process.argv.slice(3));
            return;
        }
        // Token subcommands bypass normal runtime startup
        if (process.argv[2] === 'token') {
            yield runToken(process.argv.slice(3));
            return;
        }
        // MCP stdio server — no runtime required, talks directly to the tool layer
        if (process.argv[2] === 'mcp') {
            const { runMcpStdio } = yield import('./mcp-server.js');
            yield runMcpStdio();
            return;
        }
        // Backup subcommands bypass normal runtime startup
        if (process.argv[2] === 'backup') {
            yield runBackup(process.argv.slice(3));
            return;
        }
        // Restore subcommand bypasses normal runtime startup
        if (process.argv[2] === 'restore') {
            yield runRestore(process.argv.slice(3));
            return;
        }
        // Export-trajectories subcommand bypasses normal runtime startup
        if (process.argv[2] === 'export-trajectories') {
            yield runExportTrajectories(process.argv.slice(3));
            return;
        }
        // Tunnel subcommand bypasses normal runtime startup
        if (process.argv[2] === 'tunnel') {
            yield runTunnelCommand(process.argv.slice(3));
            return;
        }
        const options = parseArgs();
        if (options.help) {
            showHelp();
            process.exit(0);
        }
        // If --port=N was given, propagate to the gateway via PYRFOR_PORT env var.
        // This must be set before runtime.start() so the gateway picks it up when
        // it calls server.listen(). Supports 0 (OS-assigned random port).
        if (options.gatewayPort !== undefined) {
            process.env['PYRFOR_PORT'] = String(options.gatewayPort);
        }
        // Load config (pre-load to resolve workspace path and persistence options;
        // PyrforRuntime will reload from the same path in start() for hot-reload).
        const configPath = (_a = options.configPath) !== null && _a !== void 0 ? _a : DEFAULT_CONFIG_PATH;
        const { config } = yield loadConfig(configPath).catch((err) => {
            logger.warn('[cli] Config load failed, using defaults', { error: String(err) });
            return { config: undefined };
        });
        // Create and start runtime
        const runtime = new PyrforRuntime({
            workspacePath: options.workspacePath || (config === null || config === void 0 ? void 0 : config.workspacePath) || DEFAULT_WORKSPACE_PATH,
            providerOptions: {
                defaultProvider: options.provider,
                enableFallback: config === null || config === void 0 ? void 0 : config.providers.enableFallback,
            },
            persistence: (config === null || config === void 0 ? void 0 : config.persistence.enabled) === false
                ? false
                : {
                    rootDir: config === null || config === void 0 ? void 0 : config.persistence.rootDir,
                    debounceMs: config === null || config === void 0 ? void 0 : config.persistence.debounceMs,
                },
            configPath,
        });
        yield runtime.start();
        const stats = runtime.getStats();
        logger.info('Runtime started', {
            workspace: stats.workspace.loaded,
            availableProviders: stats.providers.available,
        });
        // Run in selected mode
        switch (options.mode) {
            case 'daemon':
                yield runDaemon(runtime);
                break;
            case 'chat':
                yield runChat(runtime, options);
                break;
            case 'telegram':
                yield runTelegram(runtime);
                break;
            case 'once':
                yield runOnce(runtime, options);
                break;
        }
    });
}
// Run main
main().catch((error) => {
    logger.error('Fatal error', { error: String(error) });
    // eslint-disable-next-line no-console
    console.error('Fatal error:', error);
    process.exit(1);
});

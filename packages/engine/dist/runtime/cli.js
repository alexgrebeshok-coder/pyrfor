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
import path from 'path';
import { PyrforRuntime } from './index';
import { logger } from '../observability/logger';
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

Options:
  --chat              Interactive CLI mode
  --telegram          Telegram bot mode
  --once "question"   One-shot question and exit
  --workspace, -w     Workspace path (default: ~/.openclaw/workspace)
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
        logger.info('Running in Telegram bot mode');
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            logger.error('TELEGRAM_BOT_TOKEN not set');
            // eslint-disable-next-line no-console
            console.error('Error: TELEGRAM_BOT_TOKEN environment variable is required for Telegram mode');
            process.exit(1);
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
        // ── Session middleware (per-chat metadata, used for rate limiting) ─────
        bot.use(session({ initial: () => ({}) }));
        // ── Rate limit: 1 message per second per chat (memory-based, no Redis) ─
        const RATE_LIMIT_MS = 1000;
        bot.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!ctx.message)
                return next();
            const now = Date.now();
            const last = (_a = ctx.session.lastMessageAtMs) !== null && _a !== void 0 ? _a : 0;
            if (now - last < RATE_LIMIT_MS) {
                yield ctx.reply('⏳ Подождите секунду...').catch(() => { });
                return;
            }
            ctx.session.lastMessageAtMs = now;
            yield next();
        }));
        // ── Long-message helper with MarkdownV2 → plain text fallback ──────────
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
        // ── Commands ────────────────────────────────────────────────────────────
        bot.command('start', (ctx) => __awaiter(this, void 0, void 0, function* () {
            yield ctx.reply("👋 Привет! Я Pyrfor — твой AI-ассистент.\n\nНапиши мне сообщение или отправь голосовое.");
        }));
        bot.command('help', (ctx) => __awaiter(this, void 0, void 0, function* () {
            yield ctx.reply(`🤖 *Pyrfor — команды*\n\n` +
                `Просто пиши — я отвечу с помощью AI.\n\n` +
                `/start — начать диалог\n` +
                `/help — эта справка\n` +
                `/status — статус runtime\n` +
                `/stats — детальная статистика\n` +
                `/clear — сбросить контекст диалога\n\n` +
                `🎤 Голосовые сообщения транскрибируются через Whisper.`, { parse_mode: 'Markdown' });
        }));
        bot.command('status', (ctx) => __awaiter(this, void 0, void 0, function* () {
            const stats = runtime.getStats();
            yield ctx.reply(`📊 *Runtime Status*\n\n` +
                `Активных сессий: ${stats.sessions.active}\n` +
                `Токенов всего: ${stats.sessions.totalTokens}\n` +
                `Провайдеры: ${stats.providers.available.join(', ') || 'нет'}\n` +
                `Стоимость: $${stats.providers.costs.totalUsd.toFixed(4)}`, { parse_mode: 'Markdown' });
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
        // ── Voice handler ──────────────────────────────────────────────────────
        bot.on('message:voice', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const voice = ctx.message.voice;
            if (!voice)
                return;
            yield ctx.replyWithChatAction('typing').catch(() => { });
            let text;
            try {
                text = yield transcribeVoiceLocal(token, voice.file_id);
            }
            catch (err) {
                logger.error('Voice transcription failed', { error: String(err) });
                yield ctx.reply('❌ Не удалось распознать голос. Попробуй текстом.');
                return;
            }
            if (!text.trim()) {
                yield ctx.reply('🤷 Не услышал слов. Попробуй ещё раз.');
                return;
            }
            yield ctx.reply(`🎤 _${text}_`, { parse_mode: 'Markdown' }).catch(() => { });
            const chatId = String(ctx.chat.id);
            const userId = String((_b = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 'unknown');
            const result = yield runtime.handleMessage('telegram', userId, chatId, text);
            if (result.success) {
                yield replyChunked(ctx, result.response);
            }
            else {
                yield ctx.reply(`❌ Ошибка: ${(_c = result.error) !== null && _c !== void 0 ? _c : 'unknown'}`);
            }
        }));
        // ── Text handler ───────────────────────────────────────────────────────
        bot.on('message:text', (ctx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const text = ctx.message.text;
            if (text.startsWith('/'))
                return; // commands handled above
            const chatId = String(ctx.chat.id);
            const userId = String((_b = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 'unknown');
            yield ctx.replyWithChatAction('typing').catch(() => { });
            const result = yield runtime.handleMessage('telegram', userId, chatId, text);
            if (result.success) {
                yield replyChunked(ctx, result.response);
            }
            else {
                yield ctx.reply(`❌ Ошибка: ${(_c = result.error) !== null && _c !== void 0 ? _c : 'unknown'}`);
            }
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
            logger.info(`Shutting down Telegram bot (${signal})...`);
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
 * Transcribe a Telegram voice message using LOCAL whisper-cli.
 * No API keys required — runs entirely on-device.
 */
function transcribeVoiceLocal(botToken, fileId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const WHISPER_CLI = process.env.WHISPER_CLI_PATH || '/opt/homebrew/bin/whisper-cli';
        const WHISPER_MODEL = process.env.WHISPER_MODEL_PATH || '/Users/aleksandrgrebeshok/.openclaw/models/whisper/ggml-small.bin';
        const FFMPEG = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg';
        // 1. Get file path from Telegram
        const fileInfoRes = yield fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
        const fileInfo = (yield fileInfoRes.json());
        if (!fileInfo.ok || !((_a = fileInfo.result) === null || _a === void 0 ? void 0 : _a.file_path)) {
            throw new Error('Failed to get Telegram file info');
        }
        // 2. Download the audio file
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
        const audioRes = yield fetch(fileUrl);
        if (!audioRes.ok)
            throw new Error(`Failed to download voice file: ${audioRes.status}`);
        const tmpOgg = `/tmp/pyrfor_voice_${Date.now()}.ogg`;
        const tmpWav = `/tmp/pyrfor_voice_${Date.now()}.wav`;
        // 3. Save to temp file
        const arrayBuf = yield audioRes.arrayBuffer();
        const { writeFileSync } = yield import('fs');
        writeFileSync(tmpOgg, Buffer.from(arrayBuf));
        // 4. Convert to WAV (16kHz mono) via ffmpeg
        const { execSync } = yield import('child_process');
        execSync(`${FFMPEG} -y -i "${tmpOgg}" -ar 16000 -ac 1 "${tmpWav}"`, {
            stdio: 'pipe',
            timeout: 30000,
        });
        // 5. Transcribe with whisper-cli
        const result = execSync(`${WHISPER_CLI} -m "${WHISPER_MODEL}" -l ru -t 8 "${tmpWav}"`, { stdio: 'pipe', timeout: 60000, encoding: 'utf-8' });
        // 6. Parse output — extract text after timestamps like [00:00:00.000 --> 00:00:03.000] text here
        const lines = result.split('\n');
        const text = lines
            .map((l) => {
            const match = l.match(/\]\s+(.+)/);
            return match ? match[1].trim() : '';
        })
            .filter((t) => t.length > 0)
            .join(' ');
        // 7. Cleanup
        try {
            const { unlinkSync } = yield import('fs');
            unlinkSync(tmpOgg);
            unlinkSync(tmpWav);
        }
        catch (_b) {
            // ignore cleanup errors
        }
        return text;
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
// Main Entry Point
// ============================================
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const options = parseArgs();
        if (options.help) {
            showHelp();
            process.exit(0);
        }
        // Create and start runtime
        const runtime = new PyrforRuntime({
            workspacePath: options.workspacePath || DEFAULT_WORKSPACE_PATH,
            providerOptions: {
                defaultProvider: options.provider,
            },
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

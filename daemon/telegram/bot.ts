/**
 * CEOClaw Daemon — Telegram Bot (grammY)
 *
 * Improved over OpenClaw:
 * - Strict TypeScript types
 * - Prisma CRUD for real task/project operations
 * - Voice message handling with Whisper API
 * - Message sequencing per chat (from OpenClaw pattern)
 * - Update deduplication (from OpenClaw pattern)
 * - Rate limiting with grammY transformer
 *
 * Improved over old CEOClaw node-telegram-bot-api:
 * - No event handler leak (webhook handler was registering on every request)
 * - Proper middleware chain
 * - grammY is actively maintained, node-telegram-bot-api is not
 */

import { Bot, Context, session, type NextFunction } from "grammy";
import { run, sequentialize } from "@grammyjs/runner";
import { createLogger } from "../logger";
import { splitForTelegram } from "./chunker";
import type { TelegramConfig } from "../config";

const log = createLogger("telegram");

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TelegramBotOptions {
  config: TelegramConfig;
  onAIQuery: (chatId: number, query: string) => Promise<string>;
  onVoiceMessage: (chatId: number, fileId: string) => Promise<string>;
  onAddTask: (chatId: number, projectQuery: string, taskTitle: string) => Promise<string>;
  onGetStatus: (chatId: number) => Promise<string>;
  onGetProjects: (chatId: number) => Promise<string>;
  onGetTasks: (chatId: number) => Promise<string>;
  onMorningBrief: (chatId: number) => Promise<string>;
}

interface SessionData {
  lastCommand?: string;
  awaitingInput?: "project_name" | "task_title" | "ai_query";
  tempData?: Record<string, string>;
}

type BotContext = Context & { session: SessionData };

// ─── Update Deduplication (from OpenClaw pattern) ──────────────────────────

function createUpdateDedupe(maxSize = 200) {
  const seen = new Set<number>();
  const queue: number[] = [];

  return (updateId: number): boolean => {
    if (seen.has(updateId)) return true;
    seen.add(updateId);
    queue.push(updateId);

    while (queue.length > maxSize) {
      const old = queue.shift();
      if (old !== undefined) seen.delete(old);
    }

    return false;
  };
}

// ─── Sequencing Key (from OpenClaw: ensures per-chat ordering) ─────────────

function getSequentialKey(ctx: BotContext): string | undefined {
  return ctx.chat?.id ? `chat:${ctx.chat.id}` : undefined;
}

// ─── Chunked Reply Helper ───────────────────────────────────────────────────

/**
 * Send a long message in chunks to avoid Telegram's 4096 char limit.
 * Chunks are split at sentence/paragraph boundaries up to 1200 chars each.
 * If parse_mode is set, it's applied to all chunks.
 */
async function replyChunked(
  ctx: BotContext,
  text: string,
  options?: { parse_mode?: "Markdown" | "HTML"; maxChunk?: number }
): Promise<void> {
  const chunks = splitForTelegram(text, options?.maxChunk ?? 1200);

  for (const chunk of chunks) {
    await ctx.reply(chunk, {
      parse_mode: options?.parse_mode,
    });
  }
}

// ─── Bot Factory ───────────────────────────────────────────────────────────

export function createTelegramBot(options: TelegramBotOptions) {
  const { config } = options;
  const token = config.token;

  if (!token) {
    log.warn("Telegram bot disabled: no token configured");
    return null;
  }

  const bot = new Bot<BotContext>(token);
  const isDuplicate = createUpdateDedupe();

  // ─── Middleware Chain ──────────────────────────────────────────────────

  // 1. Deduplication
  bot.use(async (ctx: BotContext, next: NextFunction) => {
    if (ctx.update.update_id && isDuplicate(ctx.update.update_id)) {
      log.debug("Duplicate update skipped", { updateId: ctx.update.update_id });
      return;
    }
    await next();
  });

  // 2. Per-chat sequencing (ensures messages from same chat are processed in order)
  bot.use(sequentialize(getSequentialKey));

  // 3. Session middleware
  bot.use(
    session({
      initial: (): SessionData => ({}),
    })
  );

  // 4. Access control
  bot.use(async (ctx: BotContext, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // If allowedChatIds is empty, allow all (open mode)
    if (config.allowedChatIds.length > 0 && !config.allowedChatIds.includes(chatId)) {
      log.warn("Unauthorized chat", { chatId });
      await ctx.reply("⛔ Доступ ограничен. Свяжитесь с администратором.");
      return;
    }

    await next();
  });

  // 5. Error handling
  bot.catch((err) => {
    log.error("Bot error", {
      error: err.message,
      ctx: err.ctx?.update?.update_id?.toString() ?? "unknown",
    });
  });

  // ─── Commands ──────────────────────────────────────────────────────────

  bot.command("start", async (ctx) => {
    await ctx.reply(
      `🚀 *CEOClaw AI PM Assistant*\n\n` +
        `Я — ваш AI-помощник для управления проектами.\n\n` +
        `📋 Команды:\n` +
        `/status — статус проектов\n` +
        `/projects — список проектов\n` +
        `/tasks — текущие задачи\n` +
        `/add\\_task <проект> <задача> — создать задачу\n` +
        `/ai <вопрос> — спросить AI\n` +
        `/brief — утренний брифинг\n` +
        `🎤 Отправьте голосовое — создам задачу из речи\n\n` +
        `_Powered by CEOClaw_`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `📖 *Справка CEOClaw*\n\n` +
        `*Управление:*\n` +
        `/status — общий статус проектов\n` +
        `/projects — детальный список проектов\n` +
        `/tasks — задачи на текущую неделю\n` +
        `/add\\_task <проект> <задача> — создать задачу\n\n` +
        `*AI:*\n` +
        `/ai <вопрос> — спросить AI об управлении проектом\n` +
        `/brief — персональный утренний брифинг\n\n` +
        `*Голос:*\n` +
        `Отправьте голосовое сообщение — я распознаю речь и создам задачу или выполню команду.\n\n` +
        `*Примеры:*\n` +
        `• /ai Какие задачи просрочены?\n` +
        `• /add\\_task Мост Проверить арматуру\n` +
        `• 🎤 "Создай задачу: проверить фундамент на объекте Север"`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("status", async (ctx) => {
    const chatId = ctx.chat.id;
    try {
      await ctx.reply("⏳ Загружаю статус...");
      const result = await options.onGetStatus(chatId);
      await replyChunked(ctx, result, { parse_mode: "Markdown" });
    } catch (err) {
      log.error("Status command failed", { error: String(err) });
      await ctx.reply("❌ Не удалось получить статус");
    }
  });

  bot.command("projects", async (ctx) => {
    const chatId = ctx.chat.id;
    try {
      const result = await options.onGetProjects(chatId);
      await replyChunked(ctx, result, { parse_mode: "Markdown" });
    } catch (err) {
      log.error("Projects command failed", { error: String(err) });
      await ctx.reply("❌ Не удалось получить проекты");
    }
  });

  bot.command("tasks", async (ctx) => {
    const chatId = ctx.chat.id;
    try {
      const result = await options.onGetTasks(chatId);
      await replyChunked(ctx, result, { parse_mode: "Markdown" });
    } catch (err) {
      log.error("Tasks command failed", { error: String(err) });
      await ctx.reply("❌ Не удалось получить задачи");
    }
  });

  bot.command("add_task", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.match;

    if (!text) {
      await ctx.reply("❌ Использование: /add_task <проект> <задача>\n\nПример: /add_task Мост Проверить арматуру");
      return;
    }

    const parts = text.split(" ");
    const projectQuery = parts[0];
    const taskTitle = parts.slice(1).join(" ");

    if (!projectQuery || !taskTitle) {
      await ctx.reply("❌ Укажите проект и название задачи");
      return;
    }

    try {
      const result = await options.onAddTask(chatId, projectQuery, taskTitle);
      await replyChunked(ctx, result, { parse_mode: "Markdown" });
    } catch (err) {
      log.error("Add task failed", { error: String(err) });
      await ctx.reply("❌ Не удалось создать задачу");
    }
  });

  bot.command("ai", async (ctx) => {
    const chatId = ctx.chat.id;
    const query = ctx.match;

    if (!query) {
      await ctx.reply("❌ Использование: /ai <вопрос>\n\nПример: /ai Какие задачи просрочены?");
      return;
    }

    try {
      await ctx.reply("🤔 Думаю...");
      const result = await options.onAIQuery(chatId, query);
      await replyChunked(ctx, result, { parse_mode: "Markdown" });
    } catch (err) {
      log.error("AI command failed", { error: String(err) });
      await ctx.reply("❌ AI недоступен. Попробуйте позже.");
    }
  });

  bot.command("brief", async (ctx) => {
    const chatId = ctx.chat.id;
    try {
      await ctx.reply("📋 Генерирую брифинг...");
      const result = await options.onMorningBrief(chatId);
      await replyChunked(ctx, result, { parse_mode: "Markdown" });
    } catch (err) {
      log.error("Brief command failed", { error: String(err) });
      await ctx.reply("❌ Не удалось сгенерировать брифинг");
    }
  });

  // ─── Voice Message Handler ─────────────────────────────────────────────

  bot.on("message:voice", async (ctx) => {
    const chatId = ctx.chat.id;
    const voice = ctx.message.voice;

    log.info("Voice message received", {
      chatId,
      duration: voice.duration,
      fileSize: voice.file_size,
    });

    try {
      await ctx.reply("🎤 Распознаю голос...");
      const file = await ctx.getFile();
      const result = await options.onVoiceMessage(chatId, file.file_id);
      await replyChunked(ctx, result, { parse_mode: "Markdown" });
    } catch (err) {
      log.error("Voice processing failed", { error: String(err) });
      await ctx.reply("❌ Не удалось обработать голосовое сообщение");
    }
  });

  // Audio files (not voice notes) — same handling
  bot.on("message:audio", async (ctx) => {
    const chatId = ctx.chat.id;
    try {
      await ctx.reply("🎤 Распознаю аудио...");
      const file = await ctx.getFile();
      const result = await options.onVoiceMessage(chatId, file.file_id);
      await replyChunked(ctx, result, { parse_mode: "Markdown" });
    } catch (err) {
      log.error("Audio processing failed", { error: String(err) });
      await ctx.reply("❌ Не удалось обработать аудиофайл");
    }
  });

  // ─── Free-form text → AI ──────────────────────────────────────────────

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    // Skip commands (already handled above)
    if (text.startsWith("/")) return;

    const chatId = ctx.chat.id;
    try {
      await ctx.reply("🤔 Обрабатываю...");
      const result = await options.onAIQuery(chatId, text);
      await replyChunked(ctx, result, { parse_mode: "Markdown" });
    } catch (err) {
      log.error("Free-form AI failed", { error: String(err) });
      await ctx.reply("❌ Не удалось обработать сообщение");
    }
  });

  return bot;
}

// ─── Bot Runner ────────────────────────────────────────────────────────────

export interface BotRunner {
  start(): void;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export function startPolling(bot: Bot<BotContext>): BotRunner {
  let running = false;
  let runner: ReturnType<typeof run> | null = null;

  return {
    start() {
      if (running) return;
      running = true;

      runner = run(bot, {
        runner: {
          fetch: {
            allowed_updates: ["message", "callback_query", "edited_message"],
          },
        },
      });

      log.info("Telegram bot started (polling mode)");
    },

    async stop() {
      if (!running || !runner) return;
      running = false;

      runner.stop();
      log.info("Telegram bot stopped");
    },

    isRunning() {
      return running;
    },
  };
}

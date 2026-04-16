import { NextRequest, NextResponse } from "next/server";
import TelegramBot from "node-telegram-bot-api";
import { handleStart } from "@/lib/telegram/commands/start";
import { handleHelp } from "@/lib/telegram/commands/help";
import { handleStatus } from "@/lib/telegram/commands/status";
import { handleProjects } from "@/lib/telegram/commands/projects";
import { handleTasks } from "@/lib/telegram/commands/tasks";
import { handleAddTask } from "@/lib/telegram/commands/add-task";
import { handleAI } from "@/lib/telegram/commands/ai";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const token = process.env.TELEGRAM_BOT_TOKEN;

// Initialize bot without polling (webhook mode) — singleton
const bot = token ? new TelegramBot(token) : null;

// Register handlers ONCE at module level (not per request)
if (bot) {
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    try {
      if (text.startsWith("/start")) {
        await handleStart(bot, chatId);
      } else if (text.startsWith("/help")) {
        await handleHelp(bot, chatId);
      } else if (text.startsWith("/status")) {
        await handleStatus(bot, chatId);
      } else if (text.startsWith("/projects")) {
        await handleProjects(bot, chatId);
      } else if (text.startsWith("/tasks")) {
        await handleTasks(bot, chatId);
      } else if (text.startsWith("/add_task ")) {
        const match = text.match(/\/add_task (.+)/) as RegExpExecArray | null;
        if (match) {
          await handleAddTask(bot, chatId, match);
        }
      } else if (text.startsWith("/ai ")) {
        const match = text.match(/\/ai (.+)/);
        if (match) {
          const response = await handleAI(match[1]);
          await bot.sendMessage(chatId, response);
        }
      }
    } catch (error) {
      logger.error(`Telegram command error in chat ${chatId}:`, error);
    }
  });
}

export async function POST(req: NextRequest) {
  if (!bot) {
    logger.debug("Telegram webhook request skipped: TELEGRAM_BOT_TOKEN not set");
    return NextResponse.json(
      { ok: false, error: "Bot token not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    bot.processUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Telegram webhook error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to process update" },
      { status: 500 }
    );
  }
}

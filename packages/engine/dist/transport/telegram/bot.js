var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import TelegramBot from 'node-telegram-bot-api';
import { handleStart } from './commands/start';
import { handleHelp } from './commands/help';
import { handleStatus } from './commands/status';
import { handleProjects } from './commands/projects';
import { handleTasks } from './commands/tasks';
import { handleAddTask } from './commands/add-task';
import { handleAI } from './commands/ai';
import { logger } from '../../observability/logger';
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    logger.warn('Telegram bot disabled: TELEGRAM_BOT_TOKEN not set');
}
// Export null if token not available (bot won't start)
export const bot = token ? new TelegramBot(token, { polling: true }) : null;
if (bot) {
    logger.info('Telegram bot started');
    bot.onText(/\/start/, (msg) => {
        handleStart(bot, msg.chat.id);
    });
    bot.onText(/\/help/, (msg) => {
        handleHelp(bot, msg.chat.id);
    });
    bot.onText(/\/status/, (msg) => {
        handleStatus(bot, msg.chat.id);
    });
    bot.onText(/\/projects/, (msg) => {
        handleProjects(bot, msg.chat.id);
    });
    bot.onText(/\/tasks/, (msg) => {
        handleTasks(bot, msg.chat.id);
    });
    bot.onText(/\/add_task (.*)/, (msg, match) => {
        handleAddTask(bot, msg.chat.id, match);
    });
    bot.onText(/\/ai (.+)/, (msg, match) => __awaiter(void 0, void 0, void 0, function* () {
        if (!match)
            return;
        const response = yield handleAI(match[1]);
        bot.sendMessage(msg.chat.id, response);
    }));
}

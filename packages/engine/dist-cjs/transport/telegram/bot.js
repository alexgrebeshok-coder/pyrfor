"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = void 0;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const start_1 = require("./commands/start");
const help_1 = require("./commands/help");
const status_1 = require("./commands/status");
const projects_1 = require("./commands/projects");
const tasks_1 = require("./commands/tasks");
const add_task_1 = require("./commands/add-task");
const ai_1 = require("./commands/ai");
const logger_1 = require("../../observability/logger");
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    logger_1.logger.warn('Telegram bot disabled: TELEGRAM_BOT_TOKEN not set');
}
// Export null if token not available (bot won't start)
exports.bot = token ? new node_telegram_bot_api_1.default(token, { polling: true }) : null;
if (exports.bot) {
    logger_1.logger.info('Telegram bot started');
    exports.bot.onText(/\/start/, (msg) => {
        (0, start_1.handleStart)(exports.bot, msg.chat.id);
    });
    exports.bot.onText(/\/help/, (msg) => {
        (0, help_1.handleHelp)(exports.bot, msg.chat.id);
    });
    exports.bot.onText(/\/status/, (msg) => {
        (0, status_1.handleStatus)(exports.bot, msg.chat.id);
    });
    exports.bot.onText(/\/projects/, (msg) => {
        (0, projects_1.handleProjects)(exports.bot, msg.chat.id);
    });
    exports.bot.onText(/\/tasks/, (msg) => {
        (0, tasks_1.handleTasks)(exports.bot, msg.chat.id);
    });
    exports.bot.onText(/\/add_task (.*)/, (msg, match) => {
        (0, add_task_1.handleAddTask)(exports.bot, msg.chat.id, match);
    });
    exports.bot.onText(/\/ai (.+)/, async (msg, match) => {
        if (!match)
            return;
        const response = await (0, ai_1.handleAI)(match[1]);
        exports.bot.sendMessage(msg.chat.id, response);
    });
}

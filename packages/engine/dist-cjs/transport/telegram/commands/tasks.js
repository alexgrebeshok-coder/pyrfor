"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleTasks = void 0;
const prisma_1 = require("../../../prisma");
const handleTasks = async (bot, chatId) => {
    const tasks = await prisma_1.prisma.task.findMany();
    let message = '📋 Список задач:\n\n';
    for (const task of tasks) {
        const statusEmoji = task.status === 'done' ? '✅' : task.status === 'in_progress' ? '🔄' : '⏳';
        message += `${statusEmoji} ${task.title} [${task.status}]\n`;
    }
    bot.sendMessage(chatId, message);
};
exports.handleTasks = handleTasks;

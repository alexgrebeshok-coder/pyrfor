"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleProjects = void 0;
const prisma_1 = require("../../../prisma");
const handleProjects = async (bot, chatId) => {
    const projects = await prisma_1.prisma.project.findMany();
    let message = '📁 Список проектов:\n\n';
    for (const project of projects) {
        const priorityEmoji = project.priority === 'critical' ? '🔴' : project.priority === 'high' ? '🟠' : '🟢';
        message += `${priorityEmoji} ${project.name}\n`;
    }
    bot.sendMessage(chatId, message);
};
exports.handleProjects = handleProjects;

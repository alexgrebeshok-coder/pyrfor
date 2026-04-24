"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStatus = void 0;
const prisma_1 = require("../../../prisma");
const handleStatus = async (bot, chatId) => {
    const projects = await prisma_1.prisma.project.findMany();
    let message = '📊 Статус проектов:\n\n';
    for (const project of projects) {
        const emoji = project.status === 'active' ? '🟢' : project.status === 'completed' ? '✅' : '🟡';
        message += `${emoji} ${project.name}: ${project.status}\n`;
    }
    bot.sendMessage(chatId, message);
};
exports.handleStatus = handleStatus;

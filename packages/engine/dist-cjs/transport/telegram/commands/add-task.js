"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAddTask = void 0;
const crypto_1 = require("crypto");
const prisma_1 = require("../../../prisma");
const handleAddTask = async (bot, chatId, match) => {
    if (!match) {
        bot.sendMessage(chatId, '❌ Использование: /add_task [проект] [задача]');
        return;
    }
    const args = match[1].split(' ');
    const projectName = args[0];
    const taskTitle = args.slice(1).join(' ');
    if (!projectName || !taskTitle) {
        bot.sendMessage(chatId, '❌ Укажите проект и задачу');
        return;
    }
    const project = await prisma_1.prisma.project.findFirst({
        where: { name: { contains: projectName } },
    });
    if (!project) {
        bot.sendMessage(chatId, `❌ Проект "${projectName}" не найден`);
        return;
    }
    await prisma_1.prisma.task.create({
        data: {
            id: (0, crypto_1.randomUUID)(),
            title: taskTitle,
            projectId: project.id,
            status: 'todo',
            priority: 'medium',
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
        },
    });
    bot.sendMessage(chatId, `✅ Задача "${taskTitle}" создана в проекте ${project.name}`);
};
exports.handleAddTask = handleAddTask;

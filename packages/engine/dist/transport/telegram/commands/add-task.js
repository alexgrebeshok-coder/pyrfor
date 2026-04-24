var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from 'crypto';
import { prisma } from '../../../prisma';
export const handleAddTask = (bot, chatId, match) => __awaiter(void 0, void 0, void 0, function* () {
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
    const project = yield prisma.project.findFirst({
        where: { name: { contains: projectName } },
    });
    if (!project) {
        bot.sendMessage(chatId, `❌ Проект "${projectName}" не найден`);
        return;
    }
    yield prisma.task.create({
        data: {
            id: randomUUID(),
            title: taskTitle,
            projectId: project.id,
            status: 'todo',
            priority: 'medium',
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
        },
    });
    bot.sendMessage(chatId, `✅ Задача "${taskTitle}" создана в проекте ${project.name}`);
});

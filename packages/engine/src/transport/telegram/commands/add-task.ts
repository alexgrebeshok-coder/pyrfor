import TelegramBot from 'node-telegram-bot-api';
import { randomUUID } from 'crypto';
import { prisma } from '../../../prisma';

export const handleAddTask = async (bot: TelegramBot, chatId: number, match: RegExpExecArray | null) => {
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

  const project = await prisma.project.findFirst({
    where: { name: { contains: projectName } },
  });

  if (!project) {
    bot.sendMessage(chatId, `❌ Проект "${projectName}" не найден`);
    return;
  }

  await prisma.task.create({
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
};

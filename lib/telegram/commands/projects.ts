import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '@/lib/prisma';

export const handleProjects = async (bot: TelegramBot, chatId: number) => {
  const projects = await prisma.project.findMany();
  let message = '📁 Список проектов:\n\n';
  for (const project of projects) {
    const priorityEmoji = project.priority === 'critical' ? '🔴' : project.priority === 'high' ? '🟠' : '🟢';
    message += `${priorityEmoji} ${project.name}\n`;
  }
  bot.sendMessage(chatId, message);
};

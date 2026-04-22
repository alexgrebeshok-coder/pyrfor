import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../../../prisma';

export const handleTasks = async (bot: TelegramBot, chatId: number) => {
  const tasks = await prisma.task.findMany();
  let message = '📋 Список задач:\n\n';
  for (const task of tasks) {
    const statusEmoji = task.status === 'done' ? '✅' : task.status === 'in_progress' ? '🔄' : '⏳';
    message += `${statusEmoji} ${task.title} [${task.status}]\n`;
  }
  bot.sendMessage(chatId, message);
};

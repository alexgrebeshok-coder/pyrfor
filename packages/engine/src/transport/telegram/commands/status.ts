import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../../../prisma';

export const handleStatus = async (bot: TelegramBot, chatId: number) => {
  const projects = await prisma.project.findMany();
  let message = '📊 Статус проектов:\n\n';
  for (const project of projects) {
    const emoji = project.status === 'active' ? '🟢' : project.status === 'completed' ? '✅' : '🟡';
    message += `${emoji} ${project.name}: ${project.status}\n`;
  }
  bot.sendMessage(chatId, message);
};

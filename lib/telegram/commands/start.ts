import TelegramBot from 'node-telegram-bot-api';

export const handleStart = async (bot: TelegramBot, chatId: number) => {
  const message = `👋 Добро пожаловать в CEOClaw!

Я помогу вам управлять проектами и задачами.

Доступные команды:
/status - Статус проектов
/projects - Список проектов
/tasks - Список задач
/add_task [проект] [задача] - Создать задачу
/help - Справка`;

  bot.sendMessage(chatId, message);
};

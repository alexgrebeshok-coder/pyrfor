import TelegramBot from 'node-telegram-bot-api';

export const handleHelp = async (bot: TelegramBot, chatId: number) => {
  const message = `📚 Справка по командам CEOClaw

/status - Показать статус всех проектов
/projects - Список всех проектов
/tasks - Список всех задач
/add_task [проект] [задача] - Создать новую задачу
/help - Эта справка

Примеры:
/add_task ЧЭМК Согласовать СП
/add_task Бентонит Подготовить КП`;

  bot.sendMessage(chatId, message);
};

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleHelp = void 0;
const handleHelp = async (bot, chatId) => {
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
exports.handleHelp = handleHelp;

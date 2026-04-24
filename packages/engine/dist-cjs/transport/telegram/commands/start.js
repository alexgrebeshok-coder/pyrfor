"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStart = void 0;
const handleStart = async (bot, chatId) => {
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
exports.handleStart = handleStart;

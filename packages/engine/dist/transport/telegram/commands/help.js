var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export const handleHelp = (bot, chatId) => __awaiter(void 0, void 0, void 0, function* () {
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
});

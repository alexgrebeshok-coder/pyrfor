var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../../../prisma';
export const handleProjects = (bot, chatId) => __awaiter(void 0, void 0, void 0, function* () {
    const projects = yield prisma.project.findMany();
    let message = '📁 Список проектов:\n\n';
    for (const project of projects) {
        const priorityEmoji = project.priority === 'critical' ? '🔴' : project.priority === 'high' ? '🟠' : '🟢';
        message += `${priorityEmoji} ${project.name}\n`;
    }
    bot.sendMessage(chatId, message);
});

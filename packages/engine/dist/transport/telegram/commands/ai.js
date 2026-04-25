var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getOrchestrator } from '../../../orchestration/agents/orchestrator.js';
export function handleAI(question) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!question.trim())
            return 'Использование: /ai <вопрос>';
        try {
            const orchestrator = getOrchestrator();
            const result = yield orchestrator.execute('quick-research', question, {});
            return result.result.content || 'Нет ответа';
        }
        catch (err) {
            return `AI недоступен: ${err instanceof Error ? err.message : String(err)}`;
        }
    });
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAI = handleAI;
const orchestrator_1 = require("../../../orchestration/agents/orchestrator");
async function handleAI(question) {
    if (!question.trim())
        return 'Использование: /ai <вопрос>';
    try {
        const orchestrator = (0, orchestrator_1.getOrchestrator)();
        const result = await orchestrator.execute('quick-research', question, {});
        return result.result.content || 'Нет ответа';
    }
    catch (err) {
        return `AI недоступен: ${err instanceof Error ? err.message : String(err)}`;
    }
}

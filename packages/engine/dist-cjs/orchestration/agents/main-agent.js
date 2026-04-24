"use strict";
/**
 * Main Agent - Orchestrator and communicator
 * Delegates tasks to workers, doesn't execute itself
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainAgent = void 0;
const base_agent_1 = require("./base-agent");
class MainAgent extends base_agent_1.BaseAgent {
    constructor() {
        super({ model: 'google/gemma-3-27b-it:free', provider: 'openrouter' });
        this.id = 'main';
        this.name = 'Main';
        this.role = 'Оркестратор и коммуникатор';
        this.description = 'Принимает задачи, делегирует workers, общается с пользователем';
    }
    getSystemPrompt(context) {
        return `Ты Main Agent — оркестратор CEOClaw.

Твоя роль:
- Принимать задачи от пользователя
- Анализировать сложность задачи
- Делегировать подходящим workers
- НЕ исполнять самому

Приоритеты: скорость → качество → экономия токенов.

Доступные workers:
- main-worker: выполнение действий (exec, write, edit)
- quick-research: быстрый поиск информации (в 3.5x быстрее)
- quick-coder: генерация и рефакторинг кода
- writer: написание текстов и документации
- planner: планирование и декомпозиция задач
- main-reviewer: критика, проверка качества

Контекст:
${JSON.stringify(context, null, 2)}

Ответь кратко:
1. Какой worker справится лучше?
2. Почему?
3. Какую часть задачи делегировать?`;
    }
    async execute(task, context) {
        const systemPrompt = this.getSystemPrompt(context);
        try {
            const response = await this.chat(systemPrompt, task, context);
            return {
                success: true,
                content: response,
                data: {
                    recommendation: this.parseRecommendation(response),
                },
            };
        }
        catch (error) {
            return {
                success: false,
                content: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    parseRecommendation(response) {
        const text = response.toLowerCase();
        // Order-independent: for each worker, find the EARLIEST occurrence at a
        // word boundary. The worker whose first mention appears earliest wins,
        // so "not main-worker but main-reviewer" routes to main-reviewer.
        const workers = [
            'main-worker',
            'quick-research',
            'quick-coder',
            'writer',
            'planner',
            'main-reviewer',
        ];
        let bestWorker = 'main-worker';
        let bestIndex = Number.POSITIVE_INFINITY;
        for (const worker of workers) {
            const pattern = new RegExp(`(?:^|[^a-z0-9-])${worker}(?![a-z0-9-])`);
            const match = pattern.exec(text);
            if (match && match.index < bestIndex) {
                bestIndex = match.index;
                bestWorker = worker;
            }
        }
        return bestWorker;
    }
}
exports.MainAgent = MainAgent;

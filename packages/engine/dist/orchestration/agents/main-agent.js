/**
 * Main Agent - Orchestrator and communicator
 * Delegates tasks to workers, doesn't execute itself
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { BaseAgent } from './base-agent';
export class MainAgent extends BaseAgent {
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
    execute(task, context) {
        return __awaiter(this, void 0, void 0, function* () {
            const systemPrompt = this.getSystemPrompt(context);
            try {
                const response = yield this.chat(systemPrompt, task, context);
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
        });
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

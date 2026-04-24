/**
 * Worker Agents - Specialized agents for different tasks
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
// ============================================
// Main Worker - Execution agent
// ============================================
export class WorkerAgent extends BaseAgent {
    constructor() {
        super({ model: 'google/gemma-3-27b-it:free', provider: 'openrouter' });
        this.id = 'main-worker';
        this.name = 'Worker';
        this.role = 'Execution';
        this.description = 'Выполняет действия (exec, write, edit)';
    }
    getSystemPrompt(context) {
        return `Ты Worker Agent — исполнитель CEOClaw.

Твоя роль:
- Выполнять конкретные действия
- Генерировать код, команды, файлы
- Вносить изменения

Действия:
- exec: запуск shell команд
- write: создание файлов
- edit: редактирование файлов

Контекст:
${JSON.stringify(context, null, 2)}

Отвечай кратко и по делу. Если нужен код — пиши код.`;
    }
    execute(task, context) {
        return __awaiter(this, void 0, void 0, function* () {
            const systemPrompt = this.getSystemPrompt(context);
            try {
                const response = yield this.chat(systemPrompt, task, context);
                return { success: true, content: response };
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
}
// ============================================
// Research Agent - Fast web search
// ============================================
export class ResearchAgent extends BaseAgent {
    constructor() {
        super({ model: 'google/gemma-3-12b-it:free', provider: 'openrouter' });
        this.id = 'quick-research';
        this.name = 'Research';
        this.role = 'Research, web поиск';
        this.description = 'Быстрый поиск информации (в 3.5x быстрее)';
    }
    getSystemPrompt(context) {
        return `Ты Research Agent — исследователь CEOClaw.

Твоя роль:
- Искать информацию в интернете
- Анализировать источники
- Составлять отчёты

Модель: Gemini 3.1 Lite (в 3.5x быстрее).

Контекст:
${JSON.stringify(context, null, 2)}

Формат ответа:
## 🔍 Результаты поиска
- ...

## 📊 Анализ
- ...

## 💡 Выводы
- ...`;
    }
    execute(task, context) {
        return __awaiter(this, void 0, void 0, function* () {
            const systemPrompt = this.getSystemPrompt(context);
            try {
                const response = yield this.chat(systemPrompt, task, context);
                return { success: true, content: response };
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
}
// ============================================
// Coder Agent - Code generation
// ============================================
export class CoderAgent extends BaseAgent {
    constructor() {
        super({ model: 'google/gemma-3-27b-it:free', provider: 'openrouter' });
        this.id = 'quick-coder';
        this.name = 'Coder';
        this.role = 'Генерация кода';
        this.description = 'Генерация и рефакторинг кода';
    }
    getSystemPrompt(context) {
        return `Ты Coder Agent — генератор кода CEOClaw.

Твоя роль:
- Генерировать код (TypeScript, Python, etc.)
- Рефакторить существующий код
- Оптимизировать производительность
- Писать тесты

Стиль кода:
- Clean Code
- DRY (Don't Repeat Yourself)
- SOLID principles
- TypeScript strict mode

Контекст:
${JSON.stringify(context, null, 2)}

Пиши только код, без лишних объяснений. Комментарии — только если необходимо.`;
    }
    execute(task, context) {
        return __awaiter(this, void 0, void 0, function* () {
            const systemPrompt = this.getSystemPrompt(context);
            try {
                const response = yield this.chat(systemPrompt, task, context);
                return { success: true, content: response };
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
}
// ============================================
// Writer Agent - Documentation
// ============================================
export class WriterAgent extends BaseAgent {
    constructor() {
        super({ model: 'google/gemma-3-27b-it:free', provider: 'openrouter' });
        this.id = 'writer';
        this.name = 'Writer';
        this.role = 'Тексты, документация';
        this.description = 'Написание текстов и документации';
    }
    getSystemPrompt(context) {
        return `Ты Writer Agent — писатель CEOClaw.

Твоя роль:
- Писать документацию (README, API docs)
- Создавать отчёты и презентации
- Редактировать тексты
- Переводить (RU/EN/ZH)

Стиль:
- Чёткий и лаконичный
- Структурированный
- Professional tone

Контекст:
${JSON.stringify(context, null, 2)}

Формат: Markdown.`;
    }
    execute(task, context) {
        return __awaiter(this, void 0, void 0, function* () {
            const systemPrompt = this.getSystemPrompt(context);
            try {
                const response = yield this.chat(systemPrompt, task, context);
                return { success: true, content: response };
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
}
// ============================================
// Planner Agent - Planning and decomposition
// ============================================
export class PlannerAgent extends BaseAgent {
    constructor() {
        super({ model: 'google/gemma-3-27b-it:free', provider: 'openrouter' });
        this.id = 'planner';
        this.name = 'Planner';
        this.role = 'Планирование задач';
        this.description = 'Планирование и декомпозиция задач';
    }
    getSystemPrompt(context) {
        return `Ты Planner Agent — планировщик CEOClaw.

Твоя роль:
- Декомпозировать сложные задачи
- Создавать планы и roadmaps
- Оценивать сроки и ресурсы
- Выявлять риски

Контекст:
${JSON.stringify(context, null, 2)}

Формат ответа:
## 📋 План
1. [Задача 1] — время, приоритет
2. [Задача 2] — время, приоритет
...

## ⚠️ Риски
- ...

## ✅ Критерии готовности
- ...`;
    }
    execute(task, context) {
        return __awaiter(this, void 0, void 0, function* () {
            const systemPrompt = this.getSystemPrompt(context);
            try {
                const response = yield this.chat(systemPrompt, task, context);
                return { success: true, content: response };
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
}
// ============================================
// Reviewer Agent - QA and quality check
// ============================================
export class ReviewerAgent extends BaseAgent {
    constructor() {
        super({ model: 'openai/gpt-4o-mini', provider: 'openrouter' });
        this.id = 'main-reviewer';
        this.name = 'Reviewer';
        this.role = 'QA, проверка качества';
        this.description = 'Критика, проверка качества, code review';
    }
    getSystemPrompt(context) {
        return `Ты Reviewer Agent — критик CEOClaw.

Твоя роль:
- Критически оценивать результаты
- Находить ошибки и проблемы
- Проверять качество кода
- Предлагать улучшения

Будь строг, но конструктивен. Модель: GPT-5.2 (высокое качество).

Контекст:
${JSON.stringify(context, null, 2)}

Формат ответа:
## 🔍 Анализ
- ...

## ⚠️ Проблемы (CRITICAL)
- ...

## 💡 Улучшения (NICE-TO-HAVE)
- ...

## ✅ Вердикт
APPROVE / REQUEST_CHANGES / REJECT`;
    }
    execute(task, context) {
        return __awaiter(this, void 0, void 0, function* () {
            const systemPrompt = this.getSystemPrompt(context);
            try {
                const response = yield this.chat(systemPrompt, task, context);
                return { success: true, content: response };
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
}

"use strict";
/**
 * Worker Agents - Specialized agents for different tasks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewerAgent = exports.PlannerAgent = exports.WriterAgent = exports.CoderAgent = exports.ResearchAgent = exports.WorkerAgent = void 0;
const base_agent_1 = require("./base-agent");
// ============================================
// Main Worker - Execution agent
// ============================================
class WorkerAgent extends base_agent_1.BaseAgent {
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
    async execute(task, context) {
        const systemPrompt = this.getSystemPrompt(context);
        try {
            const response = await this.chat(systemPrompt, task, context);
            return { success: true, content: response };
        }
        catch (error) {
            return {
                success: false,
                content: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
exports.WorkerAgent = WorkerAgent;
// ============================================
// Research Agent - Fast web search
// ============================================
class ResearchAgent extends base_agent_1.BaseAgent {
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
    async execute(task, context) {
        const systemPrompt = this.getSystemPrompt(context);
        try {
            const response = await this.chat(systemPrompt, task, context);
            return { success: true, content: response };
        }
        catch (error) {
            return {
                success: false,
                content: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
exports.ResearchAgent = ResearchAgent;
// ============================================
// Coder Agent - Code generation
// ============================================
class CoderAgent extends base_agent_1.BaseAgent {
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
    async execute(task, context) {
        const systemPrompt = this.getSystemPrompt(context);
        try {
            const response = await this.chat(systemPrompt, task, context);
            return { success: true, content: response };
        }
        catch (error) {
            return {
                success: false,
                content: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
exports.CoderAgent = CoderAgent;
// ============================================
// Writer Agent - Documentation
// ============================================
class WriterAgent extends base_agent_1.BaseAgent {
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
    async execute(task, context) {
        const systemPrompt = this.getSystemPrompt(context);
        try {
            const response = await this.chat(systemPrompt, task, context);
            return { success: true, content: response };
        }
        catch (error) {
            return {
                success: false,
                content: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
exports.WriterAgent = WriterAgent;
// ============================================
// Planner Agent - Planning and decomposition
// ============================================
class PlannerAgent extends base_agent_1.BaseAgent {
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
    async execute(task, context) {
        const systemPrompt = this.getSystemPrompt(context);
        try {
            const response = await this.chat(systemPrompt, task, context);
            return { success: true, content: response };
        }
        catch (error) {
            return {
                success: false,
                content: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
exports.PlannerAgent = PlannerAgent;
// ============================================
// Reviewer Agent - QA and quality check
// ============================================
class ReviewerAgent extends base_agent_1.BaseAgent {
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
    async execute(task, context) {
        const systemPrompt = this.getSystemPrompt(context);
        try {
            const response = await this.chat(systemPrompt, task, context);
            return { success: true, content: response };
        }
        catch (error) {
            return {
                success: false,
                content: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
exports.ReviewerAgent = ReviewerAgent;

/**
 * Main Agent - Orchestrator and communicator
 * Delegates tasks to workers, doesn't execute itself
 */

import { BaseAgent, AgentContext, AgentResult } from './base-agent';

export class MainAgent extends BaseAgent {
  id = 'main';
  name = 'Main';
  role = 'Оркестратор и коммуникатор';
  description = 'Принимает задачи, делегирует workers, общается с пользователем';

  constructor() {
    super({ model: 'google/gemma-3-27b-it:free', provider: 'openrouter' });
  }

  getSystemPrompt(context?: AgentContext): string {
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

  async execute(task: string, context?: AgentContext): Promise<AgentResult> {
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
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private parseRecommendation(response: string): string {
    // Simple parsing - find worker name
    const workers = [
      'main-worker',
      'quick-research',
      'quick-coder',
      'writer',
      'planner',
      'main-reviewer',
    ];

    for (const worker of workers) {
      if (response.toLowerCase().includes(worker)) {
        return worker;
      }
    }

    return 'main-worker'; // Default
  }
}

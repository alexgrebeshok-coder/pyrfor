/**
 * Smart Agent Selector — heuristic router that maps a natural language
 * task to a built-in agent ID. This is a regex-based baseline; a
 * Wave F+ follow-up will swap this for an LLM-based planner while
 * keeping the same public API (`selectAgent`, `getAgentCapabilities`).
 *
 * Extracted from the legacy `lib/agents/agent-improvements.ts` in
 * Wave F so the selector can be imported without pulling in the
 * deprecated `ImprovedAgentExecutor`.
 */

export class SmartAgentSelector {
  /**
   * Select best agent for task based on keyword heuristics. Returns
   * `"main"` when no category fires.
   */
  selectAgent(task: string): string {
    const taskLower = task.toLowerCase();

    if (/найди|поиск|research|google|информация|что такое|кто такой/.test(taskLower)) {
      return "quick-research";
    }

    if (/код|программ|bug|исправь|рефактор|функция|скрипт|код/.test(taskLower)) {
      return "quick-coder";
    }

    if (/напиши|текст|документ|отчёт|статья|письмо/.test(taskLower)) {
      return "writer";
    }

    if (/план|расписание|срок|задача|roadmap|приоритет/.test(taskLower)) {
      return "planner";
    }

    if (/проверь|review|оценка|критика|качество|error/.test(taskLower)) {
      return "main-reviewer";
    }

    return "main";
  }

  getAgentCapabilities(agentId: string): string[] {
    const capabilities: Record<string, string[]> = {
      main: ["orchestration", "communication", "delegation"],
      "quick-research": ["web-search", "analysis", "summarization"],
      "quick-coder": ["code-generation", "debugging", "refactoring"],
      writer: ["content-creation", "documentation", "translation"],
      planner: ["task-planning", "estimation", "resource-allocation"],
      "main-reviewer": ["quality-check", "error-detection", "feedback"],
      "main-worker": ["execution", "file-operations", "script-running"],
    };

    return capabilities[agentId] ?? capabilities.main;
  }
}

export const smartSelector = new SmartAgentSelector();

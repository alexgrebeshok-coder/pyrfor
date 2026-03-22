import { getOrchestrator } from '@/lib/agents/orchestrator';

export async function handleAI(question: string): Promise<string> {
  if (!question.trim()) return 'Использование: /ai <вопрос>';
  try {
    const orchestrator = getOrchestrator();
    const result = await orchestrator.execute('quick-research', question, {});
    return result.result.content || 'Нет ответа';
  } catch (err) {
    return `AI недоступен: ${err instanceof Error ? err.message : String(err)}`;
  }
}

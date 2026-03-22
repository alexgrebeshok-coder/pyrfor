import { detectIntent, extractEntities } from './intent-detection';
import { handleAddTask } from './commands/add-task';
import { handleUpdateBudget } from './commands/update-budget';
import { handleShowStatus } from './commands/show-status';
import { handleCreateProject } from './commands/create-project';
import { handleAssignTask } from './commands/assign-task';
import { CommandResult } from './types';

/**
 * OpenClaw Integration - главный обработчик команд
 *
 * Принимает текстовые команды, определяет intent, извлекает entities,
 * выполняет соответствующую операцию и возвращает результат.
 */

export async function processCommand(input: string): Promise<string> {
  try {
    const intent = detectIntent(input);

    if (intent === 'unknown') {
      return '❓ Не понял команду. Доступные команды:\n\n' +
        '• Добавь задачу в [проект] — [задача]\n' +
        '• Обнови бюджет [проект] на [сумма]\n' +
        '• Покажи статус [проект]\n' +
        '• Создай проект [название]\n' +
        '• Назначь [человек] на [задача]';
    }

    const entities = extractEntities(input, intent);
    let result: CommandResult;

    switch (intent) {
      case 'add_task':
        result = await handleAddTask(entities);
        break;
      case 'update_budget':
        result = await handleUpdateBudget(entities);
        break;
      case 'show_status':
        result = await handleShowStatus(entities);
        break;
      case 'create_project':
        result = await handleCreateProject(entities);
        break;
      case 'assign_task':
        result = await handleAssignTask(entities);
        break;
      default:
        return '❌ Неизвестная ошибка обработки.';
    }

    return result.message;
  } catch (error) {
    console.error('Integration Error:', error);
    return '❌ Произошла ошибка при выполнении команды. Пожалуйста, попробуйте снова.';
  }
}

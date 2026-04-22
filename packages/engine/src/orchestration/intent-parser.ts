/**
 * IntentParser — parses natural language into structured commands for dashboard
 * 
 * Logic: Simple regex/keyword matching for intent detection
 */

export type Intent = 
  | 'createTask' 
  | 'listProjects' 
  | 'showStatus' 
  | 'unknown';

export interface ParsedCommand {
  intent: Intent;
  entities: {
    project?: string;
    task?: string;
    status?: string;
  };
}

export function parseCommand(text: string): ParsedCommand {
  const t = text.toLowerCase();

  // Create Task
  if (t.includes('добавь задачу') || t.includes('создай задачу')) {
    const projectMatch = t.match(/в ([\wа-яё\- ]+)/u);
    const taskMatch = t.match(/— ([\wа-яё\- ]+)/u); // " — согласовать СП"

    return {
      intent: 'createTask',
      entities: {
        project: projectMatch ? projectMatch[1].trim() : undefined,
        task: taskMatch ? taskMatch[1].trim() : text.split('—')[1]?.trim(),
      }
    };
  }

  // List projects
  if (t.includes('покажи проекты') || t.includes('список проектов')) {
    return { intent: 'listProjects', entities: {} };
  }

  // Show status
  if (t.includes('статус') || t.includes('как дела')) {
    const projectMatch = t.match(/(?:статус|дела) ([\wа-яё\- ]+)/u);
    return {
      intent: 'showStatus',
      entities: {
        project: projectMatch ? projectMatch[1].trim() : undefined
      }
    };
  }

  return { intent: 'unknown', entities: {} };
}

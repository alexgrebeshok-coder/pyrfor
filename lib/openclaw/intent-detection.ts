import { Intent, EntityMap } from './types';

export function detectIntent(input: string): Intent {
    const lower = input.toLowerCase();

    if (lower.includes('добавь задачу') || lower.includes('задачу в')) return 'add_task';
    if (lower.includes('обнови бюджет') || lower.includes('бюджет на')) return 'update_budget';
    if (lower.includes('покажи статус')) return 'show_status';
    if (lower.includes('создай проект')) return 'create_project';
    if (lower.includes('назначь')) return 'assign_task';

    return 'unknown';
}

export function extractEntities(input: string, intent: Intent): EntityMap {
    const entities: EntityMap = {};

    if (intent === 'add_task') {
        const match = input.match(/в (.+) — (.+)/i) || input.match(/в (.+) (.+)/i);
        if (match) {
            entities.project = match[1].trim();
            entities.task = match[2].trim();
        }
    } else if (intent === 'update_budget') {
        const match = input.match(/бюджет (?:на )?(.+) на (.+)/i) || input.match(/бюджет (.+)/i);
        if (match) {
            entities.project = match[1].trim(); 
            entities.amount = match[2]?.trim() || match[1].trim(); // Simple fallback
        }
    } else if (intent === 'show_status') {
        const match = input.match(/статус (.+)/i);
        if (match) {
            entities.project = match[1].trim();
        }
    } else if (intent === 'create_project') {
        const match = input.match(/проект (.+)/i);
        if (match) {
            entities.project = match[1].trim();
        }
    } else if (intent === 'assign_task') {
        const match = input.match(/назначь (.+) на (.+)/i);
        if (match) {
            entities.person = match[1].trim();
            entities.task = match[2].trim();
        }
    }

    return entities;
}

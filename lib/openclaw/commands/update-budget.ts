import { EntityMap, CommandResult } from '../types';

export async function handleUpdateBudget(entities: EntityMap): Promise<CommandResult> {
    return {
        success: true,
        message: `Бюджет проекта "${entities.project || 'неизвестно'}" обновлен на ${entities.amount || 'неизвестно'}`
    };
}

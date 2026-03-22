import { EntityMap, CommandResult } from '../types';

export async function handleShowStatus(entities: EntityMap): Promise<CommandResult> {
    console.log(`Showing status for "${entities.project}"`);
    return {
        success: true,
        message: `Статус проекта "${entities.project}" получен`
    };
}

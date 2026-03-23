import { EntityMap, CommandResult } from '../types';

export async function handleShowStatus(entities: EntityMap): Promise<CommandResult> {
    return {
        success: true,
        message: `Статус проекта "${entities.project}" получен`
    };
}

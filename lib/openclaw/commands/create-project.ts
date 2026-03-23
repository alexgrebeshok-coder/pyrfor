import { EntityMap, CommandResult } from '../types';

export async function handleCreateProject(entities: EntityMap): Promise<CommandResult> {
    return {
        success: true,
        message: `Проект "${entities.project}" успешно создан`
    };
}

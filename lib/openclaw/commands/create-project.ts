import { EntityMap, CommandResult } from '../types';

export async function handleCreateProject(entities: EntityMap): Promise<CommandResult> {
    console.log(`Creating project "${entities.project}"`);
    return {
        success: true,
        message: `Проект "${entities.project}" успешно создан`
    };
}

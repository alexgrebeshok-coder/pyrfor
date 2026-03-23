import { EntityMap, CommandResult } from '../types';

export async function handleAssignTask(entities: EntityMap): Promise<CommandResult> {
    return {
        success: true,
        message: `Задача "${entities.task}" назначена на ${entities.person}`
    };
}

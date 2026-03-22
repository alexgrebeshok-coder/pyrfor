import { EntityMap, CommandResult } from '../types';

export async function handleAssignTask(entities: EntityMap): Promise<CommandResult> {
    console.log(`Assigning task "${entities.task}" to "${entities.person}"`);
    return {
        success: true,
        message: `Задача "${entities.task}" назначена на ${entities.person}`
    };
}

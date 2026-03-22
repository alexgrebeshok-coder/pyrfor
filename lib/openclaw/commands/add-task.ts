import { EntityMap, CommandResult } from '../types';

export async function handleAddTask(entities: EntityMap): Promise<CommandResult> {
    // API Call Simulation
    console.log(`Adding task "${entities.task}" to project "${entities.project}"`);
    return {
        success: true,
        message: `Задача "${entities.task}" добавлена в проект ${entities.project}`
    };
}

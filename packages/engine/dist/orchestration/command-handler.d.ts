/**
 * CommandHandler — executes dashboard commands based on parsed intents
 *
 * Flow:
 * 1. User message → IntentParser → ParsedCommand
 * 2. ParsedCommand → CommandHandler → DashboardClient → API call
 * 3. Result → formatted response for user
 */
import { type DashboardClient } from "./dashboard-client";
export interface CommandResult {
    success: boolean;
    message: string;
    data?: unknown;
}
type DashboardClientLike = Pick<DashboardClient, "findProjectByName" | "listProjects" | "createTask" | "listTasks">;
/**
 * Execute a natural language command
 *
 * @param text - User message (e.g., "Добавь задачу в ЧЭМК — согласовать СП")
 * @returns CommandResult with success status and message
 */
export declare function executeCommand(text: string, client?: DashboardClientLike): Promise<CommandResult>;
export {};
//# sourceMappingURL=command-handler.d.ts.map
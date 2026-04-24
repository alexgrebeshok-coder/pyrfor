/**
 * IntentParser — parses natural language into structured commands for dashboard
 *
 * Logic: Simple regex/keyword matching for intent detection
 */
export type Intent = 'createTask' | 'listProjects' | 'showStatus' | 'unknown';
export interface ParsedCommand {
    intent: Intent;
    entities: {
        project?: string;
        task?: string;
        status?: string;
    };
}
export declare function parseCommand(text: string): ParsedCommand;
//# sourceMappingURL=intent-parser.d.ts.map
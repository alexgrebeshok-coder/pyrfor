/**
 * Agent Presets — ready-to-use agent configurations for construction industry
 *
 * These are used by the "Agent Templates" UI to quickly create pre-configured agents.
 * Each preset maps to an existing agent definition from agents.ts.
 */
export interface AgentPreset {
    id: string;
    name: string;
    nameRu: string;
    role: string;
    definitionId: string;
    description: string;
    descriptionRu: string;
    suggestedSchedule: string | null;
    suggestedBudgetCents: number;
    systemPromptSuffix: string;
    permissions: Record<string, boolean>;
}
export declare const AGENT_PRESETS: AgentPreset[];
export declare function getPreset(id: string): AgentPreset | undefined;
//# sourceMappingURL=agent-presets.d.ts.map
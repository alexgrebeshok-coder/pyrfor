import type { AIAgentDefinition, AIAgentCategory } from './types';
import type { MessageKey } from '../utils/translations';
export declare const AUTO_AGENT_ID = "auto-routing";
export declare const aiAgentCategories: Array<{
    id: AIAgentCategory;
    labelKey: MessageKey;
}>;
export declare const aiAgents: AIAgentDefinition[];
export declare function getAgentById(agentId: string): AIAgentDefinition | null;
//# sourceMappingURL=agents.d.ts.map
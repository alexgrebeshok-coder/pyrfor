import type { EscalationListResult } from '../escalations/types';
import type { KnowledgeLoopOverview, KnowledgeLoopQuery } from "./types";
interface KnowledgeServiceDeps {
    escalations?: EscalationListResult;
    getEscalations?: (query?: {
        includeResolved?: boolean;
        limit?: number;
        projectId?: string;
    }) => Promise<EscalationListResult>;
    now?: () => Date;
}
export declare function getKnowledgeLoopOverview(query?: KnowledgeLoopQuery, deps?: KnowledgeServiceDeps): Promise<KnowledgeLoopOverview>;
export {};
//# sourceMappingURL=service.d.ts.map
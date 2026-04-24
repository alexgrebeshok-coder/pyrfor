import { type BriefLocale } from '../briefs/locale';
import type { AlertFeed, ExecutiveProject, ExecutiveSnapshot } from '../briefs/types';
import type { EvidenceListResult, EvidenceQuery } from '../evidence/types';
import { type MemoryEntry as PrismaMemoryEntry } from '../memory/prisma-memory-manager';
import type { PortfolioPlanFactSummary, ProjectPlanFactSummary } from '../plan-fact/types';
import type { Locale } from '../utils/translations';
export interface ContextAssemblerInput {
    projectId?: string;
    locale?: string;
    interfaceLocale?: string;
    includeEvidence?: boolean;
    includeMemory?: boolean;
}
export interface ContextAssemblerDeps {
    loadSnapshot?: (filter?: {
        generatedAt?: string | Date;
        projectId?: string;
    }) => Promise<ExecutiveSnapshot>;
    loadMockSnapshot?: (filter?: {
        generatedAt?: string | Date;
        projectId?: string;
    }) => Promise<ExecutiveSnapshot>;
    loadEvidence?: (query?: EvidenceQuery) => Promise<EvidenceListResult>;
    loadMemory?: (projectId: string | null) => Promise<PrismaMemoryEntry[]>;
}
export interface ContextAssemblerIssue {
    source: "memory";
    message: string;
}
export interface ContextAssemblerResult {
    source: "live" | "mock";
    scope: "portfolio" | "project";
    generatedAt: string;
    locale: BriefLocale;
    interfaceLocale: Locale;
    projectId: string | null;
    project: ExecutiveProject | null;
    snapshot: ExecutiveSnapshot;
    alertFeed: AlertFeed;
    planFact: PortfolioPlanFactSummary | ProjectPlanFactSummary;
    evidence: EvidenceListResult | null;
    memory: PrismaMemoryEntry[];
    issues: ContextAssemblerIssue[];
}
export declare function assembleContext(input: ContextAssemblerInput, deps?: ContextAssemblerDeps): Promise<ContextAssemblerResult>;
//# sourceMappingURL=context-assembler.d.ts.map
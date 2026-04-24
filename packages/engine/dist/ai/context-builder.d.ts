import { type BriefLocale } from '../briefs/locale';
import type { AlertFeed, ExecutiveSnapshot } from '../briefs/types';
import type { EvidenceListResult, EvidenceQuery } from '../evidence/types';
import type { PortfolioPlanFactSummary, ProjectPlanFactSummary } from '../plan-fact/types';
export type AIChatFocus = "general" | "financial" | "risk" | "execution" | "team" | "reporting" | "evidence";
export interface AIChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}
export interface AIChatContextSection {
    title: string;
    bullets: string[];
}
export interface AIChatContextBundle {
    source: "live" | "mock";
    locale: BriefLocale;
    scope: "portfolio" | "project";
    focus: AIChatFocus;
    generatedAt: string;
    projectId: string | null;
    projectName: string | null;
    projectStatus: string | null;
    summary: string;
    sections: AIChatContextSection[];
    planFact: PortfolioPlanFactSummary | ProjectPlanFactSummary;
    evidence: EvidenceListResult;
    alertFeed: AlertFeed;
    systemPrompt: string;
}
export interface AIChatContextInput {
    messages: AIChatMessage[];
    projectId?: string;
    locale?: string;
}
export interface AIChatContextDeps {
    loadSnapshot?: (filter?: {
        generatedAt?: string | Date;
        projectId?: string;
    }) => Promise<ExecutiveSnapshot>;
    loadMockSnapshot?: (filter?: {
        generatedAt?: string | Date;
        projectId?: string;
    }) => Promise<ExecutiveSnapshot>;
    loadEvidence?: (query?: EvidenceQuery) => Promise<EvidenceListResult>;
}
export declare function buildAIChatContextBundle(input: AIChatContextInput, deps?: AIChatContextDeps): Promise<AIChatContextBundle>;
export declare function buildAIChatMessages(messages: AIChatMessage[], bundle: AIChatContextBundle): AIChatMessage[];
export declare function buildSystemPrompt(input: {
    focus: AIChatFocus;
    locale: BriefLocale;
    sections: AIChatContextSection[];
    summary: string;
    scope: "portfolio" | "project";
}): string;
export declare function detectAIChatFocus(message: string): AIChatFocus;
export declare function extractLatestUserMessage(messages: AIChatMessage[]): string;
//# sourceMappingURL=context-builder.d.ts.map
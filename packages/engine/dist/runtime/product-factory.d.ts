import type { AddDagNodeInput } from './durable-dag';
import { type BrowserQAReadiness } from './browser-readiness.js';
import { type ReleaseReadiness } from './release-readiness.js';
export type ProductFactoryTemplateId = 'feature' | 'refactor' | 'bugfix' | 'bot_workflow' | 'ochag_family_reminder' | 'business_brief' | 'ui_scaffold';
export declare const PRODUCT_FACTORY_TEMPLATE_IDS: readonly ProductFactoryTemplateId[];
export declare function isProductFactoryTemplateId(value: string): value is ProductFactoryTemplateId;
export interface ProductFactoryClarification {
    id: string;
    question: string;
    required: boolean;
}
export interface ProductFactoryTemplate {
    id: ProductFactoryTemplateId;
    title: string;
    description: string;
    recommendedDomainIds: string[];
    clarifications: ProductFactoryClarification[];
    deliveryArtifacts: string[];
    qualityGates: string[];
}
export interface ProductFactoryPlanInput {
    templateId: ProductFactoryTemplateId;
    prompt: string;
    answers?: Record<string, string>;
    domainIds?: string[];
}
export interface ProductFactoryIntent {
    id: string;
    templateId: ProductFactoryTemplateId;
    title: string;
    goal: string;
    domainIds: string[];
}
export interface ProductFactoryScopedPlan {
    objective: string;
    scope: string[];
    assumptions: string[];
    risks: string[];
    qualityGates: string[];
}
export interface ProductFactoryQualityGateReadiness {
    gate: string;
    status: 'ready' | 'setup_required';
    statusSource: 'local-config';
    liveProbeSkipped: true;
    approvalRequired: boolean;
    reasons: string[];
    nextStep: string;
}
export interface ProductFactoryActorWorkflowPreview {
    enabled: boolean;
    recommendedModel: 'gpt-5.4';
    actors: Array<{
        actorId: string;
        role: 'planner' | 'implementer' | 'reviewer';
        agentName: string;
        messageCount: number;
        dependsOn: string[];
    }>;
    nextStep: string;
}
export interface ProductFactoryDagPreview {
    nodes: AddDagNodeInput[];
}
export interface ProductFactoryPlanPreview {
    intent: ProductFactoryIntent;
    template: ProductFactoryTemplate;
    missingClarifications: ProductFactoryClarification[];
    scopedPlan: ProductFactoryScopedPlan;
    qualityGateReadiness: ProductFactoryQualityGateReadiness[];
    actorWorkflow: ProductFactoryActorWorkflowPreview;
    dagPreview: ProductFactoryDagPreview;
    deliveryChecklist: string[];
}
export interface ProductFactoryOptions {
    getBrowserReadiness?: () => BrowserQAReadiness;
    getReleaseReadiness?: () => ReleaseReadiness;
}
export interface ProductFactoryActorMailboxSeed {
    task: string;
    priority: number;
    idempotencyKey: string;
    payload: Record<string, unknown>;
}
export interface ProductFactoryActorSeed {
    actorId: string;
    agentId: string;
    agentName: string;
    role: string;
    goal: string;
    messages: ProductFactoryActorMailboxSeed[];
}
export declare class ProductFactory {
    private readonly options;
    private readonly templates;
    constructor(options?: ProductFactoryOptions);
    listTemplates(): ProductFactoryTemplate[];
    getTemplate(templateId: ProductFactoryTemplateId): ProductFactoryTemplate;
    previewPlan(input: ProductFactoryPlanInput): ProductFactoryPlanPreview;
    private draftIntent;
    private collectClarifications;
    private buildScopedPlan;
    private buildDagPreview;
    private buildOchagFamilyReminderDagPreview;
    private buildCeoclawBusinessBriefDagPreview;
    private buildDeliveryArtifactChecklist;
    private buildQualityGateReadiness;
    private buildActorWorkflowPreview;
}
export declare function buildProductFactoryActorSeeds(preview: ProductFactoryPlanPreview): ProductFactoryActorSeed[];
export declare function createDefaultProductFactory(options?: ProductFactoryOptions): ProductFactory;
//# sourceMappingURL=product-factory.d.ts.map
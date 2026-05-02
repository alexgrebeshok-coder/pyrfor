import type { AddDagNodeInput } from './durable-dag';
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
export interface ProductFactoryDagPreview {
    nodes: AddDagNodeInput[];
}
export interface ProductFactoryPlanPreview {
    intent: ProductFactoryIntent;
    template: ProductFactoryTemplate;
    missingClarifications: ProductFactoryClarification[];
    scopedPlan: ProductFactoryScopedPlan;
    dagPreview: ProductFactoryDagPreview;
    deliveryChecklist: string[];
}
export declare class ProductFactory {
    private readonly templates;
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
}
export declare function createDefaultProductFactory(): ProductFactory;
//# sourceMappingURL=product-factory.d.ts.map
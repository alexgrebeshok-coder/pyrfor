import { type Skill, type SkillsLibrary } from './skills-library';
export interface PublicSkillSummary {
    id: string;
    name: string;
    description: string;
    whenToUse: string[];
    tags: string[];
    stepsCount: number;
    examplesCount: number;
    estimatedTokens: number;
    systemPromptHash: string;
}
export interface SkillCatalogResponse {
    total: number;
    skills: PublicSkillSummary[];
}
export interface SkillRecommendInput {
    task: string;
    limit?: number;
}
export interface SkillRecommendResponse {
    taskPreview: string;
    limit: number;
    recommendations: PublicSkillSummary[];
}
export declare function publicSkillSummary(skill: Skill): PublicSkillSummary;
export declare function listSkillCatalog(library?: SkillsLibrary): SkillCatalogResponse;
export declare function normalizeSkillRecommendInput(input: unknown): {
    task: string;
    limit: number;
};
export declare function recommendSkillsPreview(input: unknown, library?: SkillsLibrary): SkillRecommendResponse;
//# sourceMappingURL=skill-inspector.d.ts.map
/**
 * Skills System - AI-powered capabilities
 *
 * Built-in skills for CEOClaw:
 * - Weather
 * - Research
 * - Evaluation
 * - Summary
 * - Translation
 */
export interface Skill {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: "productivity" | "analysis" | "communication" | "automation";
    keywords: string[];
    execute: (input: SkillInput) => Promise<SkillOutput>;
    validate?: (input: SkillInput) => boolean;
}
export interface SkillInput {
    query: string;
    context?: Record<string, unknown>;
    userId?: string;
    projectId?: string;
}
export interface SkillOutput {
    success: boolean;
    result: string;
    data?: Record<string, unknown>;
    sources?: string[];
    error?: string;
}
export declare const weatherSkill: Skill;
export declare const researchSkill: Skill;
export declare const summarySkill: Skill;
export declare const translationSkill: Skill;
export declare const evaluationSkill: Skill;
export declare const skillsRegistry: Skill[];
/**
 * Find matching skill for a query
 */
export declare function findSkill(query: string): Skill | null;
/**
 * Execute skill by ID
 */
export declare function executeSkill(skillId: string, input: SkillInput): Promise<SkillOutput>;
/**
 * Get all available skills
 */
export declare function getAvailableSkills(): Skill[];
/**
 * Get skills by category
 */
export declare function getSkillsByCategory(category: Skill["category"]): Skill[];
//# sourceMappingURL=index.d.ts.map
/**
 * skills-library.ts — Pyrfor canned skills library.
 *
 * Provides a registry of reusable instruction templates (Skills) that the
 * agent runtime injects into LLM context when handling a class of tasks.
 * Beats OpenClaw's 30+ built-in skills with 35+ high-quality entries.
 */
export type Skill = {
    id: string;
    name: string;
    description: string;
    whenToUse: string[];
    systemPrompt: string;
    steps: string[];
    examples: {
        input: string;
        output: string;
    }[];
    tags: string[];
    estimatedTokens?: number;
};
export declare class SkillsLibrary {
    private readonly _skills;
    constructor(initial?: Skill[]);
    register(skill: Skill): void;
    get(id: string): Skill | undefined;
    list(): Skill[];
    /**
     * Search skills by query string.
     * Scoring: name match = 3pts, tag match = 2pts, description match = 1pt.
     * Returns skills with score > 0, sorted descending by score.
     */
    search(query: string): Skill[];
    /**
     * Find the most relevant skills for a task description.
     * Combines whenToUse keyword matching with search score.
     */
    findRelevant(taskDescription: string, limit?: number): Skill[];
}
export declare function createSkillsLibrary(initial?: Skill[]): SkillsLibrary;
export declare const BUILTIN_SKILLS: Skill[];
export declare const defaultSkillsLibrary: SkillsLibrary;
//# sourceMappingURL=skills-library.d.ts.map
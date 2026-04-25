/**
 * pyrfor-pattern-to-skill.ts — Thin connector: mined patterns → FC skills.
 */
import type { FcSkill } from './pyrfor-fc-skill-writer';
import type { SkillWriter } from './pyrfor-fc-skill-writer';
export interface PatternCandidate {
    name: string;
    description: string;
    triggers?: string[];
    body: string;
    score?: number;
}
/**
 * Convert a mined pattern into an FcSkill with proper frontmatter.
 * Source defaults to 'pyrfor-pattern-miner'.
 */
export declare function patternToSkill(pattern: PatternCandidate, opts?: {
    source?: string;
    now?: () => Date;
}): FcSkill;
/**
 * Bulk: convert candidates with score >= threshold into skills, write via writer, return paths.
 */
export declare function emitSkills(candidates: PatternCandidate[], writer: SkillWriter, opts?: {
    minScore?: number;
    source?: string;
}): Promise<string[]>;
//# sourceMappingURL=pyrfor-pattern-to-skill.d.ts.map
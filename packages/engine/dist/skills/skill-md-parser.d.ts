/**
 * SKILL.md parser — converts raw markdown with YAML frontmatter into ParsedSkill.
 *
 * Expected format:
 * ```
 * ---
 * name: my-skill
 * description: Does X
 * trigger: keyword1 keyword2
 * icon: 🔧
 * category: automation
 * parameters:
 *   - name: input
 *     type: string
 * ---
 * You are an expert at X. When asked, …
 * ```
 *
 * No external dependencies — uses a minimal regex-based frontmatter splitter.
 */
export interface ParsedSkill {
    name: string;
    description: string;
    trigger?: string;
    prompt: string;
    icon?: string;
    category?: string;
    parameters?: Array<{
        name: string;
        type?: string;
    }>;
    sourcePath?: string;
}
/**
 * Parse a raw SKILL.md string into a ParsedSkill.
 * Returns null (with console.warn) if frontmatter is missing or `name` is absent.
 */
export declare function parseSkillMd(raw: string, sourcePath?: string): ParsedSkill | null;
//# sourceMappingURL=skill-md-parser.d.ts.map
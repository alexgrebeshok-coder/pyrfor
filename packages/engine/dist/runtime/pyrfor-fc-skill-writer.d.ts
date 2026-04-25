/**
 * pyrfor-fc-skill-writer.ts — Write FC skills to ~/.freeclaude/skills/.
 *
 * Handcrafted YAML frontmatter (no external deps).
 * slugify: lowercase, non-alphanumeric runs → '-', trim edges, collapse multiples.
 * Non-ASCII is stripped (Cyrillic → empty → throws with clear message).
 */
export interface SkillFrontmatter {
    name: string;
    description: string;
    triggers?: string[];
    source?: string;
    createdAt?: string;
}
export interface FcSkill {
    fm: SkillFrontmatter;
    body: string;
}
export interface SkillWriterFs {
    mkdir: (p: string, opts: {
        recursive: boolean;
    }) => Promise<void>;
    writeFile: (p: string, data: string) => Promise<void>;
    readFile: (p: string, enc: 'utf8') => Promise<string>;
    readdir: (p: string) => Promise<string[]>;
    stat?: (p: string) => Promise<any>;
}
export interface SkillWriterOptions {
    /** Skills dir. Default: ~/.freeclaude/skills */
    dir?: string;
    /** Filesystem (for tests). Default: node:fs/promises. */
    fs?: SkillWriterFs;
    /** Clock. */
    now?: () => Date;
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
}
export interface SkillWriter {
    /**
     * Write a new skill (overwrite if file exists).
     * Filename: slugified(fm.name) + '.md'.
     * Returns the file path.
     */
    write(skill: FcSkill): Promise<string>;
    /** Read all skills from dir; skip files that don't parse. */
    list(): Promise<FcSkill[]>;
    /** Get one by name (slugified). */
    get(name: string): Promise<FcSkill | null>;
}
/**
 * slugify: lowercase, strip non-ASCII, replace non-alphanumeric runs with '-',
 * trim edges, collapse multiples.
 *
 * Non-ASCII chars (e.g. Cyrillic) are stripped before processing.
 * If the result is empty or only '-', throws with a clear message.
 */
export declare function slugify(input: string): string;
/**
 * Serialize FcSkill to markdown string with YAML frontmatter.
 * Only known fields serialized; arrays as flow-style.
 */
export declare function serializeSkill(skill: FcSkill): string;
/**
 * Parse a markdown string with YAML frontmatter into FcSkill.
 * Returns null on any parse failure (no throw).
 */
export declare function parseSkill(content: string): FcSkill | null;
export declare function createFcSkillWriter(opts?: SkillWriterOptions): SkillWriter;
//# sourceMappingURL=pyrfor-fc-skill-writer.d.ts.map
/**
 * Project rules loader — reads `.pyrforrules` from a workspace and composes
 * it into the system prompt.
 */
/**
 * Reads `<workspace>/.pyrforrules` (UTF-8).
 * Returns its trimmed content (truncated to 16 KB) or `null` if the file is
 * absent or the workspace path is falsy.
 */
export declare function loadProjectRules(workspace: string): Promise<string | null>;
/**
 * Appends project rules to a base system prompt under a clearly-marked
 * separator.  If `rules` is null/empty the original prompt is returned
 * unchanged.
 */
export declare function composeSystemPrompt(base: string, rules: string | null): string;
//# sourceMappingURL=project-rules.d.ts.map
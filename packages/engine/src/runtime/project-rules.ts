/**
 * Project rules loader — reads `.pyrforrules` from a workspace and composes
 * it into the system prompt.
 */

import { readFile } from 'fs/promises';
import path from 'path';

const RULES_FILE = '.pyrforrules';
const MAX_RULES_BYTES = 16 * 1024; // 16 KB
const RULES_SEPARATOR = '\n\n---\n## Project Rules\n\n';

/**
 * Reads `<workspace>/.pyrforrules` (UTF-8).
 * Returns its trimmed content (truncated to 16 KB) or `null` if the file is
 * absent or the workspace path is falsy.
 */
export async function loadProjectRules(workspace: string): Promise<string | null> {
  if (!workspace) return null;
  const filePath = path.join(workspace, RULES_FILE);
  try {
    const buf = await readFile(filePath);
    const text = buf.slice(0, MAX_RULES_BYTES).toString('utf8').trim();
    // If we sliced, make sure we didn't cut mid-character (trimEnd handles trailing garbage).
    return text || null;
  } catch (err: unknown) {
    // ENOENT — file absent. Any other error is silently ignored.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

/**
 * Appends project rules to a base system prompt under a clearly-marked
 * separator.  If `rules` is null/empty the original prompt is returned
 * unchanged.
 */
export function composeSystemPrompt(base: string, rules: string | null): string {
  if (!rules) return base;
  return `${base}${RULES_SEPARATOR}${rules}`;
}

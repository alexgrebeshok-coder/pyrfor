/**
 * Project rules loader — reads `.pyrforrules` from a workspace and composes
 * it into the system prompt.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
export function loadProjectRules(workspace) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!workspace)
            return null;
        const filePath = path.join(workspace, RULES_FILE);
        try {
            const buf = yield readFile(filePath);
            const text = buf.slice(0, MAX_RULES_BYTES).toString('utf8').trim();
            // If we sliced, make sure we didn't cut mid-character (trimEnd handles trailing garbage).
            return text || null;
        }
        catch (err) {
            // ENOENT — file absent. Any other error is silently ignored.
            if (err.code === 'ENOENT')
                return null;
            return null;
        }
    });
}
/**
 * Appends project rules to a base system prompt under a clearly-marked
 * separator.  If `rules` is null/empty the original prompt is returned
 * unchanged.
 */
export function composeSystemPrompt(base, rules) {
    if (!rules)
        return base;
    return `${base}${RULES_SEPARATOR}${rules}`;
}

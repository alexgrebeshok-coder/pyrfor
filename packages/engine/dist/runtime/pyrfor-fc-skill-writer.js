/**
 * pyrfor-fc-skill-writer.ts — Write FC skills to ~/.freeclaude/skills/.
 *
 * Handcrafted YAML frontmatter (no external deps).
 * slugify: lowercase, non-alphanumeric runs → '-', trim edges, collapse multiples.
 * Non-ASCII is stripped (Cyrillic → empty → throws with clear message).
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
import { homedir } from 'os';
import path from 'path';
// ─── Pure helpers ──────────────────────────────────────────────────────────────
/**
 * slugify: lowercase, strip non-ASCII, replace non-alphanumeric runs with '-',
 * trim edges, collapse multiples.
 *
 * Non-ASCII chars (e.g. Cyrillic) are stripped before processing.
 * If the result is empty or only '-', throws with a clear message.
 */
export function slugify(input) {
    const result = input
        .toLowerCase()
        .replace(/[^\x00-\x7F]/g, '') // strip non-ASCII
        .replace(/[^a-z0-9]+/g, '-') // non-alnum → hyphen
        .replace(/^-+|-+$/g, '') // trim edges
        .replace(/-{2,}/g, '-'); // collapse multiples
    if (!result || result === '-') {
        throw new Error(`slugify: input "${input}" produces an empty slug after stripping non-ASCII and non-alphanumeric characters`);
    }
    return result;
}
/** Quote a YAML scalar string if it contains ':' or '#'. */
function quoteIfNeeded(s) {
    if (s.includes(':') || s.includes('#') || s.includes('"') || s.includes("'")) {
        return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return s;
}
/** Serialize array as flow-style YAML: [a, b, c] */
function serializeArray(arr) {
    return `[${arr.map(quoteIfNeeded).join(', ')}]`;
}
/**
 * Serialize FcSkill to markdown string with YAML frontmatter.
 * Only known fields serialized; arrays as flow-style.
 */
export function serializeSkill(skill) {
    const { fm, body } = skill;
    const lines = ['---'];
    lines.push(`name: ${quoteIfNeeded(fm.name)}`);
    lines.push(`description: ${quoteIfNeeded(fm.description)}`);
    if (fm.triggers && fm.triggers.length > 0) {
        lines.push(`triggers: ${serializeArray(fm.triggers)}`);
    }
    if (fm.source) {
        lines.push(`source: ${quoteIfNeeded(fm.source)}`);
    }
    if (fm.createdAt) {
        lines.push(`createdAt: ${quoteIfNeeded(fm.createdAt)}`);
    }
    lines.push('---');
    lines.push('');
    lines.push(body);
    return lines.join('\n');
}
/** Parse flow-style array `[a, b, c]` → string[] */
function parseFlowArray(raw) {
    const inner = raw.trim();
    if (!inner.startsWith('[') || !inner.endsWith(']'))
        return [];
    const content = inner.slice(1, -1).trim();
    if (!content)
        return [];
    const items = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        if (inQuote) {
            if (ch === '\\' && i + 1 < content.length) {
                i++;
                current += content[i];
            }
            else if (ch === quoteChar) {
                inQuote = false;
            }
            else {
                current += ch;
            }
        }
        else if (ch === '"' || ch === "'") {
            inQuote = true;
            quoteChar = ch;
        }
        else if (ch === ',') {
            items.push(current.trim());
            current = '';
        }
        else {
            current += ch;
        }
    }
    if (current.trim())
        items.push(current.trim());
    return items;
}
/** Unquote a YAML scalar string value. */
function unquote(s) {
    const trimmed = s.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        const inner = trimmed.slice(1, -1);
        return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return trimmed;
}
/**
 * Parse a markdown string with YAML frontmatter into FcSkill.
 * Returns null on any parse failure (no throw).
 */
export function parseSkill(content) {
    try {
        // Frontmatter must start at position 0
        if (!content.startsWith('---'))
            return null;
        const afterFirst = content.slice(3);
        // Allow '---\n' or '---\r\n'
        const restAfterOpen = afterFirst.startsWith('\n')
            ? afterFirst.slice(1)
            : afterFirst.startsWith('\r\n')
                ? afterFirst.slice(2)
                : null;
        if (restAfterOpen === null)
            return null;
        // Find closing ---
        const closeMatch = restAfterOpen.match(/^([\s\S]*?)\n---(?:\r?\n|$)/);
        if (!closeMatch)
            return null;
        const fmRaw = closeMatch[1];
        const afterFm = restAfterOpen.slice(closeMatch[0].length);
        // Strip single leading newline from body
        const body = afterFm.startsWith('\n') ? afterFm.slice(1) : afterFm;
        // Parse frontmatter key-value pairs
        const fm = {};
        for (const line of fmRaw.split('\n')) {
            const colon = line.indexOf(':');
            if (colon < 0)
                continue;
            const key = line.slice(0, colon).trim();
            const rawVal = line.slice(colon + 1).trim();
            if (!key)
                continue;
            if (rawVal.startsWith('[')) {
                const arr = parseFlowArray(rawVal);
                if (key === 'triggers')
                    fm.triggers = arr;
            }
            else {
                const val = unquote(rawVal);
                if (key === 'name')
                    fm.name = val;
                else if (key === 'description')
                    fm.description = val;
                else if (key === 'source')
                    fm.source = val;
                else if (key === 'createdAt')
                    fm.createdAt = val;
            }
        }
        if (!fm.name || !fm.description)
            return null;
        return {
            fm: fm,
            body,
        };
    }
    catch (_a) {
        return null;
    }
}
// ─── Factory ──────────────────────────────────────────────────────────────────
export function createFcSkillWriter(opts) {
    var _a, _b, _c, _d;
    const dir = (_a = opts === null || opts === void 0 ? void 0 : opts.dir) !== null && _a !== void 0 ? _a : path.join(homedir(), '.freeclaude', 'skills');
    const now = (_b = opts === null || opts === void 0 ? void 0 : opts.now) !== null && _b !== void 0 ? _b : (() => new Date());
    const log = (_c = opts === null || opts === void 0 ? void 0 : opts.logger) !== null && _c !== void 0 ? _c : (() => { });
    // Lazy-load real fs so tests can inject stubs
    let _fs = (_d = opts === null || opts === void 0 ? void 0 : opts.fs) !== null && _d !== void 0 ? _d : null;
    const getFs = () => {
        if (_fs)
            return _fs;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fsp = require('fs').promises;
        _fs = fsp;
        return _fs;
    };
    return {
        write(skill) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a;
                const fsi = getFs();
                const slug = slugify(skill.fm.name);
                const filledFm = Object.assign(Object.assign({}, skill.fm), { createdAt: (_a = skill.fm.createdAt) !== null && _a !== void 0 ? _a : now().toISOString() });
                const filled = { fm: filledFm, body: skill.body };
                const content = serializeSkill(filled);
                const filePath = path.join(dir, `${slug}.md`);
                yield fsi.mkdir(dir, { recursive: true });
                yield fsi.writeFile(filePath, content);
                log('info', `Skill written: ${filePath}`);
                return filePath;
            });
        },
        list() {
            return __awaiter(this, void 0, void 0, function* () {
                const fsi = getFs();
                let files;
                try {
                    files = yield fsi.readdir(dir);
                }
                catch (_a) {
                    return [];
                }
                const skills = [];
                for (const file of files) {
                    if (!file.endsWith('.md'))
                        continue;
                    try {
                        const content = yield fsi.readFile(path.join(dir, file), 'utf8');
                        const skill = parseSkill(content);
                        if (skill) {
                            skills.push(skill);
                        }
                        else {
                            log('warn', `Skipping unparseable skill file: ${file}`);
                        }
                    }
                    catch (err) {
                        log('warn', `Failed to read skill file: ${file}`, err);
                    }
                }
                return skills;
            });
        },
        get(name) {
            return __awaiter(this, void 0, void 0, function* () {
                const fsi = getFs();
                const slug = slugify(name);
                const filePath = path.join(dir, `${slug}.md`);
                try {
                    const content = yield fsi.readFile(filePath, 'utf8');
                    return parseSkill(content);
                }
                catch (_a) {
                    return null;
                }
            });
        },
    };
}

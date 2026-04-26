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
/** Split raw markdown into frontmatter text and body. Returns null if no frontmatter delimiters found. */
function splitFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match)
        return null;
    return { fm: match[1], body: match[2] };
}
/** Minimal YAML parser — handles scalar key: value and simple list items (- key: value). */
function parseFrontmatter(fm) {
    const result = {};
    const lines = fm.split(/\r?\n/);
    let currentListKey = null;
    const currentList = [];
    const flushList = () => {
        if (currentListKey !== null) {
            result[currentListKey] = currentList.splice(0);
        }
        currentListKey = null;
    };
    for (const line of lines) {
        // Skip empty lines
        if (!line.trim())
            continue;
        // List item under a key
        const listItemMatch = line.match(/^  - (.+)$/);
        if (listItemMatch && currentListKey !== null) {
            const itemStr = listItemMatch[1].trim();
            const itemObj = {};
            // Each list item may be "name: value" or just a value
            const kvPairs = itemStr.split(/,\s*/);
            for (const kv of kvPairs) {
                const colonIdx = kv.indexOf(':');
                if (colonIdx > 0) {
                    const k = kv.slice(0, colonIdx).trim();
                    const v = kv.slice(colonIdx + 1).trim();
                    itemObj[k] = v;
                }
                else {
                    itemObj['value'] = kv.trim();
                }
            }
            currentList.push(itemObj);
            continue;
        }
        // Top-level key: value
        const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
        if (kvMatch) {
            const key = kvMatch[1].trim();
            const value = kvMatch[2].trim();
            if (value === '' || value === '|' || value === '>') {
                // Start of a list or block scalar — handle list
                flushList();
                currentListKey = key;
                continue;
            }
            flushList();
            // Strip optional surrounding quotes
            result[key] = value.replace(/^['"](.*)['"]$/, '$1');
            continue;
        }
    }
    flushList();
    return result;
}
/**
 * Parse a raw SKILL.md string into a ParsedSkill.
 * Returns null (with console.warn) if frontmatter is missing or `name` is absent.
 */
export function parseSkillMd(raw, sourcePath) {
    const parts = splitFrontmatter(raw);
    if (!parts) {
        console.warn(`[skill-md-parser] Missing frontmatter in skill file${sourcePath ? ` (${sourcePath})` : ''} — skipping.`);
        return null;
    }
    const fm = parseFrontmatter(parts.fm);
    if (!fm['name'] || typeof fm['name'] !== 'string' || !fm['name'].trim()) {
        console.warn(`[skill-md-parser] Frontmatter missing required field "name"${sourcePath ? ` in ${sourcePath}` : ''} — skipping.`);
        return null;
    }
    const parsed = {
        name: fm['name'].trim(),
        description: typeof fm['description'] === 'string' ? fm['description'].trim() : '',
        prompt: parts.body.trim(),
    };
    if (typeof fm['trigger'] === 'string')
        parsed.trigger = fm['trigger'].trim();
    if (typeof fm['icon'] === 'string')
        parsed.icon = fm['icon'].trim();
    if (typeof fm['category'] === 'string')
        parsed.category = fm['category'].trim();
    if (Array.isArray(fm['parameters'])) {
        parsed.parameters = fm['parameters'];
    }
    if (sourcePath)
        parsed.sourcePath = sourcePath;
    return parsed;
}

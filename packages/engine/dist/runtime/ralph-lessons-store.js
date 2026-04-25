import { randomBytes } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
function makeId() {
    return Date.now().toString(36) + randomBytes(10).toString('hex');
}
function isoNow() {
    return new Date().toISOString();
}
function defaultFileName(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}.md`;
}
function parseEntriesFromMarkdown(content) {
    var _a, _b;
    const entries = [];
    // Headers: ## YYYY-MM-DD HH:MM | weight=W | tags: a,b | id=X | iteration=N | task=T
    const headerRe = /^## (.+)$/m;
    const blocks = content.split(/^(?=## )/m);
    for (const block of blocks) {
        const headerMatch = block.match(headerRe);
        if (!headerMatch)
            continue;
        const header = headerMatch[1];
        try {
            const parts = header.split('|').map((s) => s.trim());
            const createdAt = (_b = (_a = parts[0]) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : '';
            let weight = 0.5;
            let tags = [];
            let id = makeId();
            let iteration = 0;
            let task;
            for (const part of parts.slice(1)) {
                if (part.startsWith('weight='))
                    weight = parseFloat(part.slice(7));
                else if (part.startsWith('tags:'))
                    tags = part.slice(5).trim().split(',').map((t) => t.trim()).filter(Boolean);
                else if (part.startsWith('id='))
                    id = part.slice(3);
                else if (part.startsWith('iteration='))
                    iteration = parseInt(part.slice(10), 10);
                else if (part.startsWith('task='))
                    task = part.slice(5);
            }
            const bodyStart = block.indexOf('\n');
            const text = bodyStart >= 0 ? block.slice(bodyStart + 1).trim() : '';
            if (!text)
                continue;
            entries.push({ id, iteration, task, text, tags, weight, createdAt });
        }
        catch (_c) {
            // skip malformed
        }
    }
    return entries;
}
function serializeEntry(entry) {
    const taskPart = entry.task ? ` | task=${entry.task}` : '';
    const header = `## ${entry.createdAt} | weight=${entry.weight} | tags: ${entry.tags.join(',')} | id=${entry.id} | iteration=${entry.iteration}${taskPart}`;
    return `${header}\n${entry.text}\n`;
}
export function createLessonsStore(opts) {
    var _a, _b, _c;
    const dir = (_a = opts === null || opts === void 0 ? void 0 : opts.dir) !== null && _a !== void 0 ? _a : '.ralph/learnings';
    const fileNameFor = (_b = opts === null || opts === void 0 ? void 0 : opts.fileNameFor) !== null && _b !== void 0 ? _b : defaultFileName;
    const maxEntries = (_c = opts === null || opts === void 0 ? void 0 : opts.maxEntries) !== null && _c !== void 0 ? _c : 500;
    let entries = [];
    let loaded = false;
    function ensureLoaded() {
        if (!loaded) {
            loadInternal();
            loaded = true;
        }
    }
    function loadInternal() {
        entries = [];
        if (!existsSync(dir))
            return;
        let files;
        try {
            files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('archive'));
        }
        catch (_a) {
            return;
        }
        for (const file of files) {
            try {
                const content = readFileSync(path.join(dir, file), 'utf8');
                const parsed = parseEntriesFromMarkdown(content);
                entries.push(...parsed);
            }
            catch (_b) {
                // skip corrupt
            }
        }
        // Auto-archive if over maxEntries
        if (entries.length > maxEntries) {
            archiveOldest();
        }
    }
    function archiveOldest() {
        // Sort files by name (date-based), move oldest
        let files;
        try {
            files = readdirSync(dir)
                .filter((f) => f.endsWith('.md'))
                .sort();
        }
        catch (_a) {
            return;
        }
        if (files.length <= 1)
            return;
        const oldest = files[0];
        const archiveDir = path.join(dir, 'archive');
        try {
            if (!existsSync(archiveDir)) {
                require('fs').mkdirSync(archiveDir, { recursive: true });
            }
            require('fs').renameSync(path.join(dir, oldest), path.join(archiveDir, oldest));
            // Re-parse remaining files
            loadInternal();
        }
        catch (_b) {
            // ignore
        }
    }
    function flushInternal() {
        if (entries.length === 0)
            return;
        // Group entries by their date
        const byFile = new Map();
        for (const entry of entries) {
            let dateStr;
            try {
                dateStr = fileNameFor(new Date(entry.createdAt));
            }
            catch (_a) {
                dateStr = fileNameFor(new Date());
            }
            if (!byFile.has(dateStr))
                byFile.set(dateStr, []);
            byFile.get(dateStr).push(entry);
        }
        // Ensure dir exists synchronously
        try {
            require('fs').mkdirSync(dir, { recursive: true });
        }
        catch (_b) {
            // ignore
        }
        for (const [fileName, fileEntries] of byFile) {
            const filePath = path.join(dir, fileName);
            const content = fileEntries.map(serializeEntry).join('\n');
            try {
                require('fs').writeFileSync(filePath, content, 'utf8');
            }
            catch (_c) {
                // ignore
            }
        }
    }
    function filterEntries(all, filter) {
        let result = all;
        if ((filter === null || filter === void 0 ? void 0 : filter.sinceDays) !== undefined) {
            const cutoff = Date.now() - filter.sinceDays * 24 * 60 * 60 * 1000;
            result = result.filter((e) => {
                try {
                    return new Date(e.createdAt).getTime() >= cutoff;
                }
                catch (_a) {
                    return true;
                }
            });
        }
        if ((filter === null || filter === void 0 ? void 0 : filter.tags) && filter.tags.length > 0) {
            result = result.filter((e) => filter.tags.some((t) => e.tags.includes(t)));
        }
        return result;
    }
    return {
        add(entry) {
            ensureLoaded();
            const full = Object.assign(Object.assign({}, entry), { id: makeId(), createdAt: isoNow() });
            entries.push(full);
            flushInternal();
            return full;
        },
        list(filter) {
            ensureLoaded();
            return filterEntries(entries, filter);
        },
        topN(n, filter) {
            ensureLoaded();
            const filtered = filterEntries(entries, filter);
            return [...filtered]
                .sort((a, b) => {
                if (b.weight !== a.weight)
                    return b.weight - a.weight;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            })
                .slice(0, n);
        },
        renderMarkdown(filter) {
            ensureLoaded();
            let filtered = filterEntries(entries, filter);
            if ((filter === null || filter === void 0 ? void 0 : filter.limit) !== undefined) {
                filtered = filtered.slice(0, filter.limit);
            }
            if (filtered.length === 0)
                return '# Lessons\n\n';
            const bullets = filtered
                .map((e) => `- [${e.tags.join(', ')}] (w=${e.weight}) ${e.text}`)
                .join('\n');
            return `# Lessons\n\n${bullets}\n`;
        },
        clear() {
            entries = [];
            if (!existsSync(dir))
                return;
            let files;
            try {
                files = readdirSync(dir).filter((f) => f.endsWith('.md'));
            }
            catch (_a) {
                return;
            }
            for (const file of files) {
                try {
                    require('fs').unlinkSync(path.join(dir, file));
                }
                catch (_b) {
                    // ignore
                }
            }
        },
        flush() {
            flushInternal();
        },
        load() {
            loaded = false;
            loadInternal();
            loaded = true;
        },
    };
}
export function extractLessons(input) {
    const { iteration, agentOutput: _agentOutput, verifySummary, task } = input;
    // Infer tags from task keywords: split on whitespace, take 3 longest
    const taskWords = (task !== null && task !== void 0 ? task : '').split(/\s+/).filter(Boolean);
    const tags = [...taskWords].sort((a, b) => b.length - a.length).slice(0, 3).map((t) => t.toLowerCase());
    const passed = verifySummary.toLowerCase().includes('passed');
    const failed = verifySummary.toLowerCase().includes('failed');
    const lessons = [];
    if (passed) {
        lessons.push({
            iteration,
            task,
            text: `What worked: ${verifySummary}`,
            tags,
            weight: 0.8,
        });
    }
    if (failed) {
        lessons.push({
            iteration,
            task,
            text: `What to avoid: ${verifySummary}`,
            tags,
            weight: 0.6,
        });
    }
    return lessons;
}

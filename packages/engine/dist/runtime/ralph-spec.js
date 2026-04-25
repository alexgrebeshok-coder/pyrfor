function stripQuotes(s) {
    const t = s.trim();
    if ((t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t;
}
function coerceScalar(raw) {
    const t = raw.trim();
    if (t === '')
        return '';
    if ((t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    if (t === 'true')
        return true;
    if (t === 'false')
        return false;
    if (/^-?\d+(\.\d+)?$/.test(t))
        return Number(t);
    return t;
}
function indentOf(line) {
    let i = 0;
    while (i < line.length && line[i] === ' ')
        i++;
    return i;
}
function parseYaml(src) {
    const lines = src.split('\n');
    const root = {};
    // Stack of { indent, container }
    const stack = [
        { indent: -1, container: root },
    ];
    for (let idx = 0; idx < lines.length; idx++) {
        const rawLine = lines[idx];
        if (rawLine === undefined)
            continue;
        // Skip blank lines and comments
        if (rawLine.trim() === '' || rawLine.trim().startsWith('#'))
            continue;
        const indent = indentOf(rawLine);
        const content = rawLine.slice(indent);
        const colonIdx = content.indexOf(':');
        if (colonIdx === -1) {
            throw new Error(`Malformed YAML line (no colon): "${rawLine}"`);
        }
        const key = content.slice(0, colonIdx).trim();
        const valuePart = content.slice(colonIdx + 1);
        // Pop stack until we find a parent with smaller indent
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
            stack.pop();
        }
        const parent = stack[stack.length - 1].container;
        if (valuePart.trim() === '') {
            // It's a section header
            const child = {};
            parent[key] = child;
            stack.push({ indent, container: child });
        }
        else {
            parent[key] = coerceScalar(valuePart);
        }
    }
    return root;
}
export function parseRalphMd(text) {
    var _a, _b;
    // Find frontmatter delimited by --- lines
    const lines = text.split('\n');
    if (((_a = lines[0]) === null || _a === void 0 ? void 0 : _a.trim()) !== '---') {
        throw new Error('Malformed RALPH.md: missing opening --- frontmatter delimiter');
    }
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (((_b = lines[i]) === null || _b === void 0 ? void 0 : _b.trim()) === '---') {
            endIdx = i;
            break;
        }
    }
    if (endIdx === -1) {
        throw new Error('Malformed RALPH.md: missing closing --- frontmatter delimiter');
    }
    const frontmatterSrc = lines.slice(1, endIdx).join('\n');
    const body = lines.slice(endIdx + 1).join('\n');
    const fm = parseYaml(frontmatterSrc);
    if (typeof fm['task'] !== 'string' || !fm['task']) {
        throw new Error('RALPH.md missing required field: task');
    }
    const agent = typeof fm['agent'] === 'string' ? fm['agent'] : 'default';
    const task = fm['task'];
    const maxIterations = typeof fm['maxIterations'] === 'number' ? fm['maxIterations'] : 25;
    const scoreThreshold = typeof fm['scoreThreshold'] === 'number' ? fm['scoreThreshold'] : 80;
    const exitToken = typeof fm['exitToken'] === 'string' && fm['exitToken']
        ? fm['exitToken']
        : '<promise>COMPLETE</promise>';
    const commands = {};
    if (fm['commands'] && typeof fm['commands'] === 'object') {
        for (const [k, v] of Object.entries(fm['commands'])) {
            commands[k] = typeof v === 'string' ? v : String(v);
        }
    }
    const env = {};
    let hasEnv = false;
    if (fm['env'] && typeof fm['env'] === 'object') {
        hasEnv = true;
        for (const [k, v] of Object.entries(fm['env'])) {
            env[k] = typeof v === 'string' ? v : String(v);
        }
    }
    let scoring;
    if (fm['scoring'] && typeof fm['scoring'] === 'object') {
        const s = fm['scoring'];
        scoring = {};
        if (typeof s['tests'] === 'number')
            scoring.tests = s['tests'];
        if (typeof s['lint'] === 'number')
            scoring.lint = s['lint'];
        if (typeof s['typecheck'] === 'number')
            scoring.typecheck = s['typecheck'];
        if (s['custom'] && typeof s['custom'] === 'object') {
            const custom = {};
            for (const [k, v] of Object.entries(s['custom'])) {
                if (typeof v === 'number')
                    custom[k] = v;
            }
            scoring.custom = custom;
        }
    }
    const cwd = typeof fm['cwd'] === 'string' ? fm['cwd'] : undefined;
    // Render task into body's {{ task }} (so prompt template can include task)
    const promptTemplate = body.startsWith('\n') ? body.slice(1) : body;
    const spec = {
        agent,
        task,
        maxIterations,
        scoreThreshold,
        promptTemplate: promptTemplate.replace(/\{\{\s*task\s*\}\}/g, task),
        commands,
        exitToken,
    };
    if (scoring)
        spec.scoring = scoring;
    if (cwd)
        spec.cwd = cwd;
    if (hasEnv)
        spec.env = env;
    return spec;
}
export function renderPrompt(spec, ctx) {
    var _a, _b;
    let out = spec.promptTemplate;
    // commands.X
    out = out.replace(/\{\{\s*commands\.([A-Za-z0-9_-]+)\s*\}\}/g, (_m, k) => {
        var _a;
        return (_a = spec.commands[k]) !== null && _a !== void 0 ? _a : '';
    });
    out = out.replace(/\{\{\s*iteration\s*\}\}/g, String(ctx.iteration));
    out = out.replace(/\{\{\s*progress\s*\}\}/g, (_a = ctx.progress) !== null && _a !== void 0 ? _a : '');
    out = out.replace(/\{\{\s*lessons\s*\}\}/g, (_b = ctx.lessons) !== null && _b !== void 0 ? _b : '');
    out = out.replace(/\{\{\s*lastScore\s*\}\}/g, ctx.lastScore !== undefined ? String(ctx.lastScore) : '');
    if (ctx.lastVerify) {
        const v = ctx.lastVerify;
        const summary = [
            `total=${v.total} threshold=${v.threshold} passed=${v.passed}`,
            ...v.checks.map((c) => `- ${c.name}: ${c.passed ? 'PASS' : 'FAIL'} (score=${c.score}, exit=${c.exitCode})`),
        ].join('\n');
        out = out.replace(/\{\{\s*verifyResults\s*\}\}/g, summary);
    }
    else {
        out = out.replace(/\{\{\s*verifyResults\s*\}\}/g, '');
    }
    return out;
}

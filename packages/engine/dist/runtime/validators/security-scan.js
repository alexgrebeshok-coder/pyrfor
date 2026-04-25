var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const DEFAULT_PATTERNS = [
    { pattern: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key ID (AKIA...)' },
    { pattern: /AIza[0-9A-Za-z\-_]{35}/, label: 'Google API Key (AIza...)' },
    { pattern: /ghp_[0-9A-Za-z]{36}/, label: 'GitHub Personal Access Token (ghp_...)' },
    { pattern: /sk-[A-Za-z0-9]{32,}/, label: 'Secret key (sk-...)' },
    { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/, label: 'Private key block' },
    { pattern: /password\s*=\s*['"][^'"]{3,}['"]/, label: 'Hardcoded password' },
    { pattern: /api_key\s*=\s*['"][^'"]{3,}['"]/, label: 'Hardcoded API key' },
    { pattern: /eval\s*\(/, label: 'eval() call' },
    { pattern: /child_process\.exec\s*\(/, label: 'child_process.exec (potential injection)' },
];
function extractTextContent(data) {
    if (typeof data === 'string')
        return data;
    if (typeof data === 'object' && data !== null) {
        const d = data;
        const candidates = ['content', 'code', 'diff', 'patch', 'text', 'body'];
        for (const key of candidates) {
            if (typeof d[key] === 'string')
                return d[key];
        }
        return JSON.stringify(data);
    }
    return '';
}
function isEditOrDiff(event) {
    var _a;
    if (event.type === 'diff')
        return true;
    if (event.type === 'tool_call' || event.type === 'tool_call_update') {
        const data = event.data;
        const kind = String((_a = data === null || data === void 0 ? void 0 : data['kind']) !== null && _a !== void 0 ? _a : '');
        return kind === 'edit';
    }
    return false;
}
export function createSecurityScanValidator(opts) {
    var _a;
    const patterns = [
        ...DEFAULT_PATTERNS,
        ...((_a = opts === null || opts === void 0 ? void 0 : opts.extraPatterns) !== null && _a !== void 0 ? _a : []).map((p) => ({ pattern: p, label: `custom: ${p.source}` })),
    ];
    return {
        name: 'security-scan',
        appliesTo(event) {
            return isEditOrDiff(event);
        },
        validate(event, _ctx) {
            return __awaiter(this, void 0, void 0, function* () {
                const start = Date.now();
                const text = extractTextContent(event.data);
                const lines = text.split('\n');
                for (const { pattern, label } of patterns) {
                    for (let i = 0; i < lines.length; i++) {
                        if (pattern.test(lines[i])) {
                            const durationMs = Date.now() - start;
                            return {
                                validator: 'security-scan',
                                verdict: 'block',
                                message: `Security issue detected: ${label}`,
                                details: {
                                    pattern: pattern.source,
                                    line: i + 1,
                                    snippet: lines[i].slice(0, 120),
                                },
                                remediation: 'Remove sensitive data before committing',
                                durationMs,
                            };
                        }
                    }
                }
                const durationMs = Date.now() - start;
                return {
                    validator: 'security-scan',
                    verdict: 'pass',
                    message: 'No security issues detected',
                    durationMs,
                };
            });
        },
    };
}

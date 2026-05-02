/**
 * Security-Reviewer Subagent
 *
 * Single-purpose subagent that receives a set of source-file blobs from the
 * caller (content is passed in — we never read the disk, keeping this module
 * pure and testable), runs a battery of regex-based heuristics against each
 * file, and returns a structured report of potential security issues with
 * severity ratings and remediation hints.
 *
 * This is a fast first-pass reviewer.  Its findings are intended to be
 * triaged by a downstream agent or human engineer before any action is taken.
 *
 * Usage:
 *   import { runSecurityReviewer } from './security-reviewer.js';
 *   const report = await runSecurityReviewer({ files });
 *
 * @module security-reviewer
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
// ====== Constants ======
/** All severities in ascending rank order — used to zero-fill summary maps. */
const ALL_SEVERITIES = ['low', 'medium', 'high', 'critical'];
/** All finding kinds — used to zero-fill summary maps. */
const ALL_KINDS = [
    'hardcoded_secret',
    'sql_injection_risk',
    'command_injection_risk',
    'path_traversal_risk',
    'insecure_random',
    'weak_crypto',
    'eval_use',
    'unsafe_yaml_load',
    'cors_wildcard',
    'http_url_in_prod',
    'todo_security_marker',
];
const SNIPPET_MAX = 200;
// ====== Pure Helpers ======
/**
 * Map a Severity to a comparable numeric rank.
 * critical=4, high=3, medium=2, low=1
 */
export function severityRank(s) {
    switch (s) {
        case 'critical': return 4;
        case 'high': return 3;
        case 'medium': return 2;
        case 'low': return 1;
    }
}
/**
 * Return true when `path` should be excluded from scanning.
 * A file is skipped when ANY element of `patterns` is a substring of `path`
 * (case-sensitive).  An empty patterns array never skips any file.
 */
export function shouldSkip(path, patterns) {
    return patterns.some(p => path.includes(p));
}
/**
 * Trim a source line and truncate to SNIPPET_MAX chars, appending "…" when cut.
 */
function makeSnippet(rawLine) {
    const trimmed = rawLine.trim();
    return trimmed.length > SNIPPET_MAX
        ? trimmed.slice(0, SNIPPET_MAX) + '…'
        : trimmed;
}
// ====== Remediation Hints ======
const REMEDIATION = {
    hardcoded_secret: 'Move secrets to environment variables or a secrets manager; ' +
        'never commit credentials to source control.',
    sql_injection_risk: 'Use parameterised queries or prepared statements instead of ' +
        'string concatenation or unescaped template literals.',
    command_injection_risk: 'Pass commands as argument arrays to spawn(); validate and ' +
        'sanitise all user-supplied input before any shell execution.',
    path_traversal_risk: 'Validate and normalise paths; resolve against a fixed base ' +
        'directory and reject paths that escape it.',
    insecure_random: 'Use crypto.randomBytes() or crypto.getRandomValues() for ' +
        'security-sensitive random values.',
    weak_crypto: 'Replace MD5/SHA-1 with SHA-256 or stronger (SHA-3, BLAKE2) ' +
        'for all security-critical hashing.',
    eval_use: 'Avoid eval() and new Function(); use JSON.parse() or a ' +
        'purpose-built sandboxed evaluator instead.',
    unsafe_yaml_load: 'Pass an explicit safe schema: yaml.load(str, { schema: yaml.FAILSAFE_SCHEMA }) ' +
        'or switch to yaml.safeLoad() to prevent arbitrary code execution.',
    cors_wildcard: 'Restrict Access-Control-Allow-Origin to a known allowlist of origins; ' +
        'never use a wildcard on authenticated APIs.',
    http_url_in_prod: 'Switch to HTTPS endpoints in production to prevent eavesdropping ' +
        'and traffic interception.',
    todo_security_marker: 'Resolve the outstanding security/auth TODO before shipping to production; ' +
        'track it in your issue tracker.',
};
// ====== Message Generators ======
function makeMessage(kind, line) {
    switch (kind) {
        case 'hardcoded_secret':
            return `Potential hardcoded secret or credential detected at line ${line}.`;
        case 'sql_injection_risk':
            return `Possible SQL injection via dynamic string construction at line ${line}.`;
        case 'command_injection_risk':
            return `Possible command injection via template literal in shell call at line ${line}.`;
        case 'path_traversal_risk':
            return `Unsanitised request parameter used in path construction at line ${line}.`;
        case 'insecure_random':
            return `Math.random() used in a security-sensitive context at line ${line}.`;
        case 'weak_crypto':
            return `Weak cryptographic hash (MD5 or SHA-1) used at line ${line}.`;
        case 'eval_use':
            return `Unsafe use of eval() or new Function() at line ${line}.`;
        case 'unsafe_yaml_load':
            return `yaml.load() called without a safe schema at line ${line}.`;
        case 'cors_wildcard':
            return `CORS wildcard origin (*) detected at line ${line}.`;
        case 'http_url_in_prod':
            return `Plain HTTP URL (not HTTPS) found at line ${line}.`;
        case 'todo_security_marker':
            return `Security/auth-related TODO or FIXME comment at line ${line}.`;
    }
}
const PATTERNS = [
    // ---- hardcoded_secret ----
    {
        kind: 'hardcoded_secret',
        regex: /(api[_-]?key|secret|token|passwd|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i,
        severity: 'critical',
        confidence: 0.85,
    },
    {
        kind: 'hardcoded_secret',
        regex: /-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----/,
        severity: 'critical',
        confidence: 0.99,
    },
    // ---- sql_injection_risk ----
    {
        kind: 'sql_injection_risk',
        // String-concat into SQL keyword OR template literal with interpolation
        regex: /(SELECT|INSERT|UPDATE|DELETE)[^;`]*\+\s*\w+|`[^`]*\$\{[^}]+\}[^`]*`/i,
        severity: 'high',
        confidence: 0.7,
        contextRequired: /query|execute|\.raw\(/i,
    },
    // ---- command_injection_risk ----
    {
        kind: 'command_injection_risk',
        regex: /child_process\.(exec|execSync)\s*\([^)]*\$\{|spawn\s*\(\s*[^,)]+\$\{/,
        severity: 'high',
        confidence: 0.8,
    },
    // ---- path_traversal_risk ----
    {
        kind: 'path_traversal_risk',
        regex: /path\.(join|resolve)\([^)]*req\.(params|query|body)/,
        severity: 'medium',
        confidence: 0.55,
    },
    // ---- insecure_random (only when in a security-sensitive context) ----
    {
        kind: 'insecure_random',
        regex: /Math\.random\s*\(\s*\)/,
        severity: 'medium',
        confidence: 0.65,
        contextRequired: /token|secret|password|salt|nonce/i,
    },
    // ---- weak_crypto ----
    {
        kind: 'weak_crypto',
        regex: /createHash\(\s*['"](md5|sha1)['"]\)|\bmd5\(|\bsha1\(/i,
        severity: 'medium',
        confidence: 0.7,
    },
    // ---- eval_use ----
    {
        kind: 'eval_use',
        regex: /\beval\s*\(|new Function\s*\(/,
        severity: 'high',
        confidence: 0.95,
    },
    // ---- unsafe_yaml_load (single-argument call only — no schema) ----
    {
        kind: 'unsafe_yaml_load',
        regex: /yaml\.load\s*\([^,)]*\)/,
        severity: 'high',
        confidence: 0.85,
    },
    // ---- cors_wildcard ----
    {
        kind: 'cors_wildcard',
        regex: /Access-Control-Allow-Origin\s*['"]?:\s*['"]\*['"]?|cors\(\s*\{\s*origin:\s*['"]\*['"]/,
        severity: 'medium',
        confidence: 0.75,
    },
    // ---- http_url_in_prod (localhost / 127.0.0.1 / 0.0.0.0 filtered) ----
    {
        kind: 'http_url_in_prod',
        regex: /\bhttp:\/\/[^\s'"`]+/,
        severity: 'low',
        confidence: 0.4,
        excludeMatch: /localhost|127\.0\.0\.1|0\.0\.0\.0/,
    },
    // ---- todo_security_marker ----
    {
        kind: 'todo_security_marker',
        regex: /(TODO|FIXME|XXX)[^\n]*(security|auth|password|token|secret|crypto)/i,
        severity: 'low',
        confidence: 0.5,
    },
];
// ====== Core Logic ======
/**
 * Scan a single source file and return all findings.
 *
 * The function walks lines exactly once.  Multiple pattern kinds may match a
 * single line — one Finding is emitted per (line, kind) pair.  When two
 * patterns share the same kind and both match the same line, the first match
 * (highest confidence) wins and the duplicate is suppressed.
 *
 * Pure: no I/O, no side-effects; deterministic for the same input.
 */
export function scanFile(file) {
    const findings = [];
    const lines = file.content.split('\n');
    // Track emitted (lineNum, kind) pairs to avoid duplicate findings.
    const emitted = new Set();
    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const lineNum = i + 1; // 1-based
        for (const pat of PATTERNS) {
            const dedupeKey = `${lineNum}:${pat.kind}`;
            if (emitted.has(dedupeKey))
                continue;
            const match = pat.regex.exec(rawLine);
            if (!match)
                continue;
            // Context guard: secondary regex must also match the same line.
            if (pat.contextRequired && !pat.contextRequired.test(rawLine))
                continue;
            // Exclusion guard: matched text must not match the exclusion pattern.
            if (pat.excludeMatch && pat.excludeMatch.test(match[0]))
                continue;
            emitted.add(dedupeKey);
            findings.push({
                id: `${file.path}:${lineNum}:${pat.kind}`,
                filePath: file.path,
                line: lineNum,
                column: match.index + 1,
                kind: pat.kind,
                severity: pat.severity,
                message: makeMessage(pat.kind, lineNum),
                snippet: makeSnippet(rawLine),
                remediation: REMEDIATION[pat.kind],
                confidence: pat.confidence,
            });
        }
    }
    return findings;
}
// ====== Aggregate Helpers ======
/** Build a zero-filled bySeverity map. */
function zeroSeverityMap() {
    return Object.fromEntries(ALL_SEVERITIES.map(s => [s, 0]));
}
/** Build a zero-filled byKind map. */
function zeroKindMap() {
    return Object.fromEntries(ALL_KINDS.map(k => [k, 0]));
}
// ====== Main Entry Point ======
/**
 * Run the security-reviewer pipeline across all provided files:
 *  1. Skip files that match any ignorePattern.
 *  2. Scan each remaining file with scanFile().
 *  3. Filter findings by severityFloor (if set).
 *  4. Truncate to maxFindings (if set).
 *  5. Build summary counts from the final (possibly truncated) findings array.
 *
 * NOTE: summary.bySeverity and summary.byKind reflect the findings array
 * AFTER severityFloor filtering and maxFindings truncation.  If maxFindings
 * cuts the list, the summary will under-count the true totals.  This is
 * intentional — the summary describes what the caller received, not what
 * was internally discovered.
 */
export function runSecurityReviewer(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const { files, ignorePatterns = [], maxFindings, severityFloor, } = input;
        const floor = severityFloor !== undefined ? severityRank(severityFloor) : 0;
        let filesScanned = 0;
        let filesSkipped = 0;
        let allFindings = [];
        for (const file of files) {
            if (shouldSkip(file.path, ignorePatterns)) {
                filesSkipped += 1;
                continue;
            }
            filesScanned += 1;
            const fileFindings = scanFile(file);
            for (const f of fileFindings) {
                if (severityRank(f.severity) >= floor) {
                    allFindings.push(f);
                }
            }
        }
        // Apply maxFindings cap.
        if (maxFindings !== undefined) {
            allFindings = allFindings.slice(0, maxFindings);
        }
        // Build summary from the final findings array.
        const bySeverity = zeroSeverityMap();
        const byKind = zeroKindMap();
        for (const f of allFindings) {
            bySeverity[f.severity] += 1;
            byKind[f.kind] += 1;
        }
        return {
            generatedAt: new Date().toISOString(),
            filesScanned,
            filesSkipped,
            findings: allFindings,
            summary: { bySeverity, byKind },
        };
    });
}
// ====== Subagent Spec ======
/**
 * Return the typed-subagent spec descriptor.
 * Can be registered with the SubagentSpawner runtime — do NOT register here,
 * just expose the descriptor.  Call is idempotent (returns a fresh plain object
 * each time; no mutable state).
 */
export function subagentSpec() {
    return {
        name: 'security-reviewer',
        description: 'Scans a set of caller-supplied source-file blobs using regex-based ' +
            'heuristics to detect potential security issues (hardcoded secrets, ' +
            'injection vectors, weak crypto, etc.) and returns a structured report ' +
            'with severity ratings and remediation hints.  Designed as a fast ' +
            'first-pass reviewer whose output is triaged by a downstream agent or ' +
            'human engineer.',
        inputSchema: {
            type: 'object',
            required: ['files'],
            properties: {
                files: {
                    type: 'array',
                    description: 'Source files to scan (content passed by value — no disk I/O).',
                    items: {
                        type: 'object',
                        required: ['path', 'content'],
                        properties: {
                            path: { type: 'string', description: 'Virtual or real file path; used in finding IDs.' },
                            content: { type: 'string', description: 'Full source content of the file.' },
                            language: { type: 'string', description: 'Hint for the file language; informational only.' },
                        },
                    },
                },
                ignorePatterns: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Substring patterns — files whose path contains any pattern are skipped.',
                },
                maxFindings: {
                    type: 'number',
                    description: 'Cap on findings returned; summary reflects the truncated set.',
                },
                severityFloor: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'critical'],
                    description: 'Suppress findings below this severity.',
                },
            },
        },
        outputSchema: {
            type: 'object',
            required: ['generatedAt', 'filesScanned', 'filesSkipped', 'findings', 'summary'],
            properties: {
                generatedAt: { type: 'string', format: 'date-time' },
                filesScanned: { type: 'number' },
                filesSkipped: { type: 'number' },
                findings: {
                    type: 'array',
                    items: { type: 'object' },
                },
                summary: {
                    type: 'object',
                    properties: {
                        bySeverity: { type: 'object', additionalProperties: { type: 'number' } },
                        byKind: { type: 'object', additionalProperties: { type: 'number' } },
                    },
                },
            },
        },
    };
}

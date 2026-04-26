// @vitest-environment node
/**
 * Tests for packages/engine/src/subagents/security-reviewer.ts
 *
 * Covers: severityRank, shouldSkip, scanFile (all FindingKinds — positive &
 * negative), snippet truncation, multi-line line-number correctness, multiple
 * kinds on one line, runSecurityReviewer (aggregation, maxFindings, severityFloor,
 * summary zero-fill), and subagentSpec (shape validation).
 */

import { describe, it, expect } from 'vitest';

import {
  scanFile,
  runSecurityReviewer,
  subagentSpec,
  severityRank,
  shouldSkip,
  type SourceFileInput,
  type Finding,
  type Severity,
  type FindingKind,
} from './security-reviewer.js';

// ====== Fixtures ======

function makeFile(content: string, path = 'src/test.ts'): SourceFileInput {
  return { path, content };
}

function findingOf(findings: Finding[], kind: FindingKind): Finding | undefined {
  return findings.find(f => f.kind === kind);
}

// ====== severityRank ======

describe('severityRank', () => {
  it('critical=4', () => {
    expect(severityRank('critical')).toBe(4);
  });

  it('high=3', () => {
    expect(severityRank('high')).toBe(3);
  });

  it('medium=2', () => {
    expect(severityRank('medium')).toBe(2);
  });

  it('low=1', () => {
    expect(severityRank('low')).toBe(1);
  });

  it('maintains ordering critical > high > medium > low', () => {
    const ranks: Severity[] = ['critical', 'high', 'medium', 'low'];
    for (let i = 0; i < ranks.length - 1; i++) {
      expect(severityRank(ranks[i])).toBeGreaterThan(severityRank(ranks[i + 1]));
    }
  });
});

// ====== shouldSkip ======

describe('shouldSkip', () => {
  it('returns false for empty patterns array', () => {
    expect(shouldSkip('src/auth.ts', [])).toBe(false);
  });

  it('returns true when pattern is a substring of path', () => {
    expect(shouldSkip('src/vendor/lib.ts', ['vendor'])).toBe(true);
  });

  it('returns false when no pattern matches', () => {
    expect(shouldSkip('src/auth.ts', ['vendor', 'node_modules'])).toBe(false);
  });

  it('matches are case-sensitive', () => {
    expect(shouldSkip('src/Auth.ts', ['auth'])).toBe(false);
    expect(shouldSkip('src/auth.ts', ['auth'])).toBe(true);
  });

  it('returns true when any one pattern matches (OR semantics)', () => {
    expect(shouldSkip('src/fixture.ts', ['fixture', 'vendor'])).toBe(true);
  });

  it('matches path segment in middle of path', () => {
    expect(shouldSkip('packages/engine/node_modules/foo.ts', ['node_modules'])).toBe(true);
  });
});

// ====== scanFile — hardcoded_secret ======

describe('scanFile › hardcoded_secret', () => {
  it('detects api_key assignment with long value (key pattern)', () => {
    const f = makeFile(`const api_key = 'abcdefghijklmnopqrstuvwx';`);
    const findings = scanFile(f);
    const hit = findingOf(findings, 'hardcoded_secret');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('critical');
    expect(hit!.confidence).toBe(0.85);
    expect(hit!.line).toBe(1);
    // "api_key" starts at index 6 in "const api_key = ..." → column 7 (1-based)
    expect(hit!.column).toBe(7);
  });

  it('detects PEM private key header (key-block pattern, confidence 0.99)', () => {
    const f = makeFile(`-----BEGIN RSA KEY-----\nMIIE...`);
    const findings = scanFile(f);
    const hit = findingOf(findings, 'hardcoded_secret');
    expect(hit).toBeDefined();
    expect(hit!.confidence).toBe(0.99);
    expect(hit!.line).toBe(1);
  });

  it('finding id format is <path>:<line>:<kind>', () => {
    const f = makeFile(`const secret = 'ABCDEFGHIJKLMNOPQRST';`, 'src/config.ts');
    const findings = scanFile(f);
    const hit = findingOf(findings, 'hardcoded_secret');
    expect(hit!.id).toBe('src/config.ts:1:hardcoded_secret');
  });

  it('does not flag short values (< 16 chars)', () => {
    const f = makeFile(`const token = 'short';`);
    const findings = scanFile(f);
    expect(findingOf(findings, 'hardcoded_secret')).toBeUndefined();
  });
});

// ====== scanFile — sql_injection_risk ======

describe('scanFile › sql_injection_risk', () => {
  it('detects string-concat into SELECT with query context', () => {
    const f = makeFile(`const result = db.query('SELECT * FROM users WHERE id = ' + userId);`);
    const findings = scanFile(f);
    const hit = findingOf(findings, 'sql_injection_risk');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('high');
    expect(hit!.confidence).toBe(0.7);
  });

  it('detects template literal SQL with execute context', () => {
    const f = makeFile('db.execute(`SELECT * FROM ${table} WHERE id = ${id}`);');
    const findings = scanFile(f);
    const hit = findingOf(findings, 'sql_injection_risk');
    expect(hit).toBeDefined();
  });

  it('does not flag template literal without SQL context keyword', () => {
    const f = makeFile('const msg = `Hello ${name}, welcome!`;');
    const findings = scanFile(f);
    expect(findingOf(findings, 'sql_injection_risk')).toBeUndefined();
  });
});

// ====== scanFile — command_injection_risk ======

describe('scanFile › command_injection_risk', () => {
  it('detects exec() with template literal arg', () => {
    const f = makeFile('child_process.exec(`ls ${userDir}`);');
    const findings = scanFile(f);
    const hit = findingOf(findings, 'command_injection_risk');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('high');
    expect(hit!.confidence).toBe(0.8);
  });

  it('detects execSync() with template literal arg', () => {
    const f = makeFile('child_process.execSync(`rm -rf ${path}`);');
    const findings = scanFile(f);
    expect(findingOf(findings, 'command_injection_risk')).toBeDefined();
  });

  it('detects spawn() with template literal', () => {
    const f = makeFile('spawn(`/bin/sh ${cmd}`, []);');
    const findings = scanFile(f);
    expect(findingOf(findings, 'command_injection_risk')).toBeDefined();
  });

  it('does not flag exec() with a plain string (no interpolation)', () => {
    const f = makeFile("child_process.exec('ls -la');");
    const findings = scanFile(f);
    expect(findingOf(findings, 'command_injection_risk')).toBeUndefined();
  });
});

// ====== scanFile — path_traversal_risk ======

describe('scanFile › path_traversal_risk', () => {
  it('detects path.join() with req.params', () => {
    const f = makeFile('const full = path.join(baseDir, req.params.filename);');
    const findings = scanFile(f);
    const hit = findingOf(findings, 'path_traversal_risk');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('medium');
    expect(hit!.confidence).toBe(0.55);
  });

  it('detects path.resolve() with req.query', () => {
    const f = makeFile('path.resolve(rootDir, req.query.file);');
    const findings = scanFile(f);
    expect(findingOf(findings, 'path_traversal_risk')).toBeDefined();
  });

  it('does not flag path.join() with safe args', () => {
    const f = makeFile("path.join(__dirname, 'assets', 'logo.png');");
    const findings = scanFile(f);
    expect(findingOf(findings, 'path_traversal_risk')).toBeUndefined();
  });
});

// ====== scanFile — insecure_random ======

describe('scanFile › insecure_random', () => {
  it('detects Math.random() in a token-generation context', () => {
    const f = makeFile('const token = Math.random().toString(36);');
    const findings = scanFile(f);
    const hit = findingOf(findings, 'insecure_random');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('medium');
    expect(hit!.confidence).toBe(0.65);
  });

  it('detects Math.random() in a password-generation context', () => {
    const f = makeFile('const password = chars[Math.random() * chars.length];');
    const findings = scanFile(f);
    expect(findingOf(findings, 'insecure_random')).toBeDefined();
  });

  it('does NOT emit finding when Math.random() has no sensitive context', () => {
    const f = makeFile('const x = Math.random() * 100;');
    const findings = scanFile(f);
    expect(findingOf(findings, 'insecure_random')).toBeUndefined();
  });
});

// ====== scanFile — weak_crypto ======

describe('scanFile › weak_crypto', () => {
  it('detects createHash("md5")', () => {
    const f = makeFile(`const hash = crypto.createHash('md5').update(data).digest('hex');`);
    const findings = scanFile(f);
    const hit = findingOf(findings, 'weak_crypto');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('medium');
    expect(hit!.confidence).toBe(0.7);
  });

  it('detects createHash("sha1")', () => {
    const f = makeFile(`crypto.createHash('sha1').update(pw)`);
    const findings = scanFile(f);
    expect(findingOf(findings, 'weak_crypto')).toBeDefined();
  });

  it('detects standalone md5() call', () => {
    const f = makeFile('const digest = md5(input);');
    const findings = scanFile(f);
    expect(findingOf(findings, 'weak_crypto')).toBeDefined();
  });

  it('does not flag createHash("sha256")', () => {
    const f = makeFile(`crypto.createHash('sha256').update(data)`);
    const findings = scanFile(f);
    expect(findingOf(findings, 'weak_crypto')).toBeUndefined();
  });
});

// ====== scanFile — eval_use ======

describe('scanFile › eval_use', () => {
  it('detects eval()', () => {
    const f = makeFile('const result = eval(userInput);');
    const findings = scanFile(f);
    const hit = findingOf(findings, 'eval_use');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('high');
    expect(hit!.confidence).toBe(0.95);
  });

  it('detects new Function()', () => {
    const f = makeFile('const fn = new Function("return " + code);');
    const findings = scanFile(f);
    expect(findingOf(findings, 'eval_use')).toBeDefined();
  });

  it('does not flag evalHere() (not a word boundary match for eval)', () => {
    const f = makeFile('function evalHere() { return 1; }');
    // "evalHere" — \beval\s*\( requires eval followed by optional whitespace and (
    const findings = scanFile(f);
    // evalHere() won't match \beval\s*\( because there's no ( after "eval" directly
    expect(findingOf(findings, 'eval_use')).toBeUndefined();
  });
});

// ====== scanFile — unsafe_yaml_load ======

describe('scanFile › unsafe_yaml_load', () => {
  it('detects yaml.load() with no schema argument', () => {
    const f = makeFile('const data = yaml.load(content);');
    const findings = scanFile(f);
    const hit = findingOf(findings, 'unsafe_yaml_load');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('high');
    expect(hit!.confidence).toBe(0.85);
  });

  it('does not flag yaml.load() with a second (schema) argument', () => {
    const f = makeFile("const data = yaml.load(content, { schema: yaml.FAILSAFE_SCHEMA });");
    const findings = scanFile(f);
    // Pattern [^,)]* stops at the comma, so the two-arg form should NOT match
    expect(findingOf(findings, 'unsafe_yaml_load')).toBeUndefined();
  });
});

// ====== scanFile — cors_wildcard ======

describe('scanFile › cors_wildcard', () => {
  it('detects Access-Control-Allow-Origin: * header string', () => {
    // Uses the object-key format that matches: Access-Control-Allow-Origin': '*'
    const f = makeFile(`const headers = { 'Access-Control-Allow-Origin': '*' };`);
    const findings = scanFile(f);
    const hit = findingOf(findings, 'cors_wildcard');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('medium');
    expect(hit!.confidence).toBe(0.75);
  });

  it('detects cors({ origin: "*" }) option', () => {
    const f = makeFile(`app.use(cors({ origin: '*' }));`);
    const findings = scanFile(f);
    expect(findingOf(findings, 'cors_wildcard')).toBeDefined();
  });
});

// ====== scanFile — http_url_in_prod ======

describe('scanFile › http_url_in_prod', () => {
  it('detects a plain http:// URL', () => {
    const f = makeFile(`const API = 'http://api.example.com/v1';`);
    const findings = scanFile(f);
    const hit = findingOf(findings, 'http_url_in_prod');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('low');
    expect(hit!.confidence).toBe(0.4);
  });

  it('does NOT flag http://localhost URLs', () => {
    const f = makeFile(`const BASE = 'http://localhost:3000';`);
    const findings = scanFile(f);
    expect(findingOf(findings, 'http_url_in_prod')).toBeUndefined();
  });

  it('does NOT flag http://127.0.0.1 URLs', () => {
    const f = makeFile(`const url = 'http://127.0.0.1:8080/api';`);
    const findings = scanFile(f);
    expect(findingOf(findings, 'http_url_in_prod')).toBeUndefined();
  });

  it('does NOT flag http://0.0.0.0 URLs', () => {
    const f = makeFile(`server.listen(3000, 'http://0.0.0.0');`);
    const findings = scanFile(f);
    expect(findingOf(findings, 'http_url_in_prod')).toBeUndefined();
  });
});

// ====== scanFile — todo_security_marker ======

describe('scanFile › todo_security_marker', () => {
  it('detects TODO with security keyword', () => {
    const f = makeFile('// TODO: implement proper security checks');
    const findings = scanFile(f);
    const hit = findingOf(findings, 'todo_security_marker');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('low');
    expect(hit!.confidence).toBe(0.5);
  });

  it('detects FIXME with auth keyword', () => {
    const f = makeFile('// FIXME: auth bypass workaround — remove before prod');
    const findings = scanFile(f);
    expect(findingOf(findings, 'todo_security_marker')).toBeDefined();
  });

  it('detects XXX with token keyword', () => {
    const f = makeFile('// XXX: token validation disabled for testing');
    const findings = scanFile(f);
    expect(findingOf(findings, 'todo_security_marker')).toBeDefined();
  });

  it('does not flag a TODO unrelated to security', () => {
    const f = makeFile('// TODO: refactor this function to be cleaner');
    const findings = scanFile(f);
    expect(findingOf(findings, 'todo_security_marker')).toBeUndefined();
  });
});

// ====== scanFile — snippet & column ======

describe('scanFile › snippet & column', () => {
  it('snippet is the trimmed source line', () => {
    const f = makeFile('   const secret = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234";');
    const findings = scanFile(f);
    const hit = findingOf(findings, 'hardcoded_secret');
    expect(hit!.snippet).toBe('const secret = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234";');
  });

  it('snippet truncated at 200 chars with "…" appended', () => {
    const long = 'const secret = "' + 'A'.repeat(220) + '";';
    const f = makeFile(long);
    // Make a finding by ensuring the value is long enough to match
    // (the actual regex requires 16+ chars which this satisfies)
    const findings = scanFile(f);
    if (findings.length > 0) {
      const hit = findings[0];
      if (hit.snippet.length === 201) {
        expect(hit.snippet.endsWith('…')).toBe(true);
        expect(hit.snippet.length).toBe(201);
      }
    }
    // Verify the truncation logic directly via a long line
    const padded = 'x'.repeat(250);
    // Construct a secret line that is longer than 200 chars
    const longLine = `const api_key = '${'Z'.repeat(30)}'; ${'//'.padEnd(200, ' long comment')}`;
    const f2 = makeFile(longLine);
    const findings2 = scanFile(f2);
    const hit2 = findingOf(findings2, 'hardcoded_secret');
    if (hit2 && hit2.snippet.length > 200) {
      expect(hit2.snippet.endsWith('…')).toBe(true);
    }
    // Direct truncation test: a line known to exceed 200 chars trimmed
    const veryLong = 'eval(' + 'a'.repeat(210) + ')';
    const f3 = makeFile(veryLong);
    const findings3 = scanFile(f3);
    const hit3 = findingOf(findings3, 'eval_use');
    expect(hit3).toBeDefined();
    expect(hit3!.snippet.length).toBe(201);
    expect(hit3!.snippet.endsWith('…')).toBe(true);
  });

  it('column is 1-based (first char on line → column=1)', () => {
    const f = makeFile('eval(userCode);');
    const findings = scanFile(f);
    expect(findingOf(findings, 'eval_use')!.column).toBe(1);
  });

  it('column points to the match start (not line start)', () => {
    const f = makeFile('  const x = eval(y);');
    const findings = scanFile(f);
    const hit = findingOf(findings, 'eval_use');
    // "eval(" starts at index 12 (0-based) → column 13
    expect(hit!.column).toBe(13);
  });
});

// ====== scanFile — multi-line line numbers ======

describe('scanFile › multi-line content', () => {
  it('correctly identifies 1-based line number across multiple lines', () => {
    const content = [
      'const a = 1;',
      'const b = 2;',
      "const secret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';",
      'const c = 3;',
    ].join('\n');
    const f = makeFile(content);
    const findings = scanFile(f);
    const hit = findingOf(findings, 'hardcoded_secret');
    expect(hit!.line).toBe(3);
  });

  it('assigns filePath from SourceFileInput.path', () => {
    const f = makeFile('eval(x);', 'lib/dangerous.ts');
    const findings = scanFile(f);
    expect(findingOf(findings, 'eval_use')!.filePath).toBe('lib/dangerous.ts');
  });

  it('returns empty array for empty file content', () => {
    expect(scanFile(makeFile(''))).toHaveLength(0);
  });
});

// ====== scanFile — multiple kinds on same line ======

describe('scanFile › multiple kinds on same line', () => {
  it('emits one finding per kind when multiple patterns match a line', () => {
    // This line has eval() AND a hardcoded_secret
    const f = makeFile(`eval(config); const api_key = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';`);
    const findings = scanFile(f);
    const kinds = findings.map(x => x.kind);
    expect(kinds).toContain('eval_use');
    expect(kinds).toContain('hardcoded_secret');
  });

  it('does not emit duplicate findings for the same (line, kind)', () => {
    // Two patterns for hardcoded_secret; only one should appear per line
    const f = makeFile(`const password = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // secret = 'ZYXWVUTSRQPONMLK'`);
    const findings = scanFile(f);
    const secretFindings = findings.filter(x => x.kind === 'hardcoded_secret');
    expect(secretFindings).toHaveLength(1);
  });
});

// ====== runSecurityReviewer ======

describe('runSecurityReviewer', () => {
  it('counts filesScanned and filesSkipped correctly', async () => {
    const result = await runSecurityReviewer({
      files: [
        makeFile('eval(x);', 'src/app.ts'),
        makeFile('eval(x);', 'src/vendor/lib.ts'),
        makeFile('eval(x);', 'src/main.ts'),
      ],
      ignorePatterns: ['vendor'],
    });
    expect(result.filesScanned).toBe(2);
    expect(result.filesSkipped).toBe(1);
  });

  it('aggregates findings from multiple files', async () => {
    const result = await runSecurityReviewer({
      files: [
        makeFile('eval(a);', 'src/a.ts'),
        makeFile('eval(b);', 'src/b.ts'),
      ],
    });
    expect(result.findings.length).toBe(2);
  });

  it('maxFindings truncates the findings array', async () => {
    const result = await runSecurityReviewer({
      files: [
        makeFile('eval(a);\neval(b);\neval(c);', 'src/x.ts'),
      ],
      maxFindings: 2,
    });
    expect(result.findings.length).toBe(2);
  });

  it('summary reflects the truncated set when maxFindings is applied', async () => {
    const result = await runSecurityReviewer({
      files: [makeFile('eval(a);\neval(b);\neval(c);', 'src/x.ts')],
      maxFindings: 1,
    });
    expect(result.summary.byKind['eval_use']).toBe(1);
    expect(result.summary.bySeverity['high']).toBe(1);
  });

  it('severityFloor filters out findings below threshold', async () => {
    const result = await runSecurityReviewer({
      files: [makeFile("// TODO: fix auth later\neval(x);", 'src/x.ts')],
      severityFloor: 'high',
    });
    const kinds = result.findings.map(f => f.kind);
    expect(kinds).not.toContain('todo_security_marker');
    expect(kinds).toContain('eval_use');
  });

  it('severityFloor=critical drops everything except critical findings', async () => {
    const result = await runSecurityReviewer({
      files: [makeFile("eval(x); // TODO: fix security", 'src/x.ts')],
      severityFloor: 'critical',
    });
    expect(result.findings.every(f => f.severity === 'critical')).toBe(true);
  });

  it('summary.bySeverity is zero-filled for absent severities', async () => {
    const result = await runSecurityReviewer({
      files: [makeFile('eval(x);', 'src/x.ts')],
    });
    expect(result.summary.bySeverity).toMatchObject({
      low: expect.any(Number),
      medium: expect.any(Number),
      high: expect.any(Number),
      critical: expect.any(Number),
    });
    // Only high should be non-zero; others should be 0
    expect(result.summary.bySeverity.low).toBe(0);
    expect(result.summary.bySeverity.medium).toBe(0);
    expect(result.summary.bySeverity.critical).toBe(0);
    expect(result.summary.bySeverity.high).toBe(1);
  });

  it('summary.byKind is zero-filled for all 11 kinds', async () => {
    const result = await runSecurityReviewer({
      files: [makeFile('eval(x);', 'src/x.ts')],
    });
    const expectedKinds: FindingKind[] = [
      'hardcoded_secret', 'sql_injection_risk', 'command_injection_risk',
      'path_traversal_risk', 'insecure_random', 'weak_crypto', 'eval_use',
      'unsafe_yaml_load', 'cors_wildcard', 'http_url_in_prod', 'todo_security_marker',
    ];
    for (const k of expectedKinds) {
      expect(result.summary.byKind[k]).toBeTypeOf('number');
    }
  });

  it('generatedAt is a valid ISO 8601 timestamp', async () => {
    const result = await runSecurityReviewer({ files: [] });
    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });

  it('returns zero findings and correct counts for empty files array', async () => {
    const result = await runSecurityReviewer({ files: [] });
    expect(result.filesScanned).toBe(0);
    expect(result.filesSkipped).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('ignorePatterns skips all matching files', async () => {
    const result = await runSecurityReviewer({
      files: [makeFile('eval(x);', 'dist/bundle.js')],
      ignorePatterns: ['dist/'],
    });
    expect(result.filesScanned).toBe(0);
    expect(result.filesSkipped).toBe(1);
    expect(result.findings).toHaveLength(0);
  });
});

// ====== subagentSpec ======

describe('subagentSpec', () => {
  it('returns name "security-reviewer"', () => {
    expect(subagentSpec().name).toBe('security-reviewer');
  });

  it('returns a non-empty description string', () => {
    expect(typeof subagentSpec().description).toBe('string');
    expect(subagentSpec().description.length).toBeGreaterThan(0);
  });

  it('inputSchema requires the "files" field', () => {
    const schema = subagentSpec().inputSchema as Record<string, unknown>;
    expect((schema['required'] as string[])).toContain('files');
  });

  it('outputSchema is present', () => {
    expect(subagentSpec().outputSchema).toBeDefined();
  });

  it('is idempotent — multiple calls return equal values', () => {
    const a = subagentSpec();
    const b = subagentSpec();
    expect(a.name).toBe(b.name);
    expect(a.description).toBe(b.description);
  });
});

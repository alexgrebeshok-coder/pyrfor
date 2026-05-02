// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ApprovalFlow } from './approval-flow';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

async function makeTempDir(): Promise<string> {
  if (!tempDir) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pyrfor-approval-'));
  }
  return tempDir;
}

afterAll(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function tempSettings(name: string, dir: string): string {
  return path.join(dir, `${name}.json`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApprovalFlow — auto-approve', () => {
  it('auto-approves read tool immediately', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('auto-read', dir) });
    const decision = await flow.requestApproval({
      id: crypto.randomUUID(),
      toolName: 'read',
      summary: 'read: /etc/hosts',
      args: { path: '/etc/hosts' },
    });
    expect(decision).toBe('approve');
  });

  it('auto-approves web_search', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('auto-web', dir) });
    const decision = await flow.requestApproval({
      id: crypto.randomUUID(),
      toolName: 'web_search',
      summary: 'web_search: nodejs docs',
      args: { query: 'nodejs docs' },
    });
    expect(decision).toBe('approve');
  });

  it('auto-approves process_list', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('auto-plist', dir) });
    const decision = await flow.requestApproval({
      id: crypto.randomUUID(),
      toolName: 'process_list',
      summary: 'process_list: {}',
      args: {},
    });
    expect(decision).toBe('approve');
  });
});

describe('ApprovalFlow — blocked', () => {
  it('blocks exec with rm -rf /', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('block-rmrf', dir) });
    const decision = await flow.requestApproval({
      id: crypto.randomUUID(),
      toolName: 'exec',
      summary: 'exec: rm -rf /',
      args: { command: 'rm -rf /' },
    });
    expect(decision).toBe('deny');
  });

  it('blocks shell_exec with the same command patterns as exec', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('block-shell-exec-rmrf', dir) });
    const decision = await flow.requestApproval({
      id: crypto.randomUUID(),
      toolName: 'shell_exec',
      summary: 'shell_exec: rm -rf /',
      args: { command: 'rm -rf /' },
    });
    expect(decision).toBe('deny');
  });

  it('blocks exec with sudo command', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('block-sudo', dir) });
    const decision = await flow.requestApproval({
      id: crypto.randomUUID(),
      toolName: 'exec',
      summary: 'exec: sudo rm -rf /var',
      args: { command: 'sudo rm -rf /var' },
    });
    expect(decision).toBe('deny');
  });

  it('blocks exec with DROP TABLE', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('block-drop', dir) });
    const decision = await flow.requestApproval({
      id: crypto.randomUUID(),
      toolName: 'exec',
      summary: 'exec: DROP TABLE users',
      args: { command: 'DROP TABLE users' },
    });
    expect(decision).toBe('deny');
  });
});

describe('ApprovalFlow — ask + resolveDecision', () => {
  it('exec npm install enters pending; resolveDecision approve resolves', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('ask-npm', dir) });

    const requestId = crypto.randomUUID();
    const pendingEmit: unknown[] = [];
    flow.events.on('approval-requested', (req) => pendingEmit.push(req));

    const promise = flow.requestApproval({
      id: requestId,
      toolName: 'exec',
      summary: 'exec: npm install foo',
      args: { command: 'npm install foo' },
    });

    // Give the event loop a tick to ensure the event was emitted
    await new Promise((r) => setTimeout(r, 5));
    expect(pendingEmit).toHaveLength(1);
    expect(flow.getPending()).toHaveLength(1);
    expect(flow.getPending()[0].id).toBe(requestId);

    flow.resolveDecision(requestId, 'approve');
    const decision = await promise;
    expect(decision).toBe('approve');
    expect(flow.getPending()).toHaveLength(0);
  });

  it('resolveDecision deny resolves with deny', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('ask-deny', dir) });

    const requestId = crypto.randomUUID();
    const promise = flow.requestApproval({
      id: requestId,
      toolName: 'exec',
      summary: 'exec: npm run build',
      args: { command: 'npm run build' },
    });

    await new Promise((r) => setTimeout(r, 5));
    flow.resolveDecision(requestId, 'deny');
    const decision = await promise;
    expect(decision).toBe('deny');
    expect(flow.listAudit(10).map((event) => event.type)).toContain('approval.denied');
  });

  it('records tool outcome audit metadata', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('tool-outcome', dir) });

    flow.recordToolOutcome({
      requestId: 'req-1',
      toolCallId: 'call-1',
      toolName: 'exec',
      summary: 'exec: npm test',
      args: { command: 'npm test' },
      decision: 'approve',
      sessionId: 'session-1',
      resultSummary: '{"ok":true}',
      undo: { supported: false },
    });

    expect(flow.listAudit(1)[0]).toMatchObject({
      type: 'tool.executed',
      requestId: 'req-1',
      toolCallId: 'call-1',
      decision: 'approve',
      resultSummary: '{"ok":true}',
      undo: { supported: false },
    });
  });

  it('browser tool enters ask state', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('ask-browser', dir) });

    const requestId = crypto.randomUUID();
    const promise = flow.requestApproval({
      id: requestId,
      toolName: 'browser',
      summary: 'browser: https://example.com',
      args: { url: 'https://example.com' },
    });

    await new Promise((r) => setTimeout(r, 5));
    expect(flow.getPending()).toHaveLength(1);
    flow.resolveDecision(requestId, 'approve');
    const decision = await promise;
    expect(decision).toBe('approve');
  });
});

describe('ApprovalFlow — TTL timeout', () => {
  it('resolves to timeout after ttlMs with no resolution', async () => {
    const dir = await makeTempDir();
    const flow = new ApprovalFlow({ settingsPath: tempSettings('ttl', dir), ttlMs: 50 });

    const requestId = crypto.randomUUID();
    const promise = flow.requestApproval({
      id: requestId,
      toolName: 'exec',
      summary: 'exec: npm install express',
      args: { command: 'npm install express' },
    });

    const start = Date.now();
    const decision = await promise;
    const elapsed = Date.now() - start;

    expect(decision).toBe('timeout');
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(flow.getPending()).toHaveLength(0);
  }, 1000);
});

describe('ApprovalFlow — settings: whitelist', () => {
  it('categorize returns auto for whitelisted command', async () => {
    const dir = await makeTempDir();
    const settingsFile = tempSettings('whitelist', dir);

    await fs.writeFile(
      settingsFile,
      JSON.stringify({ whitelist: ['npm test'] }, null, 2),
      'utf-8',
    );

    const flow = new ApprovalFlow({ settingsPath: settingsFile });
    await flow.loadSettings();

    const category = flow.categorize('exec', { command: 'npm test' });
    expect(category).toBe('auto');
  });

  it('whitelist blocks dangerous pattern override', async () => {
    const dir = await makeTempDir();
    const settingsFile = tempSettings('wl-blocked', dir);

    // whitelist cannot override blocked patterns
    await fs.writeFile(
      settingsFile,
      JSON.stringify({ whitelist: ['rm -rf /'] }, null, 2),
      'utf-8',
    );

    const flow = new ApprovalFlow({ settingsPath: settingsFile });
    await flow.loadSettings();

    // blacklist check happens before whitelist — blocked patterns checked before whitelist
    // so rm -rf / stays blocked (blacklist checked first, then block patterns, then whitelist)
    // Actually per spec: blacklist first → block patterns → whitelist → autoApprovePatterns → ...
    // The dangerous pattern rm -rf / is in DEFAULT_BLOCKED_PATTERNS
    // Whitelist only overrides user blacklist, not built-in blocked patterns
    // Per our implementation: blacklist → blocked patterns → whitelist
    // So 'rm -rf /' still gets blocked before whitelist is checked
    const category = flow.categorize('exec', { command: 'rm -rf /' });
    expect(category).toBe('block');
  });
});

describe('ApprovalFlow — settings: save + addToWhitelist', () => {
  it('addToWhitelist persists to file and categorize uses it', async () => {
    const dir = await makeTempDir();
    const settingsFile = tempSettings('save-wl', dir);

    const flow = new ApprovalFlow({ settingsPath: settingsFile });
    await flow.addToWhitelist('npm test');

    // Read back from disk
    const raw = await fs.readFile(settingsFile, 'utf-8');
    const saved = JSON.parse(raw) as { whitelist: string[] };
    expect(saved.whitelist).toContain('npm test');

    // A new flow instance loading the same file
    const flow2 = new ApprovalFlow({ settingsPath: settingsFile });
    await flow2.loadSettings();
    expect(flow2.categorize('exec', { command: 'npm test' })).toBe('auto');
  });
});

describe('ApprovalFlow — settings: blacklist', () => {
  it('user blacklist entries block matching summaries', async () => {
    const dir = await makeTempDir();
    const settingsFile = tempSettings('user-bl', dir);

    const flow = new ApprovalFlow({ settingsPath: settingsFile });
    await flow.addToBlacklist('dangerous-script.sh');

    const category = flow.categorize('exec', { command: './dangerous-script.sh' });
    expect(category).toBe('block');
  });
});

describe('ApprovalFlow — settings: defaultAction', () => {
  it('defaultAction=approve makes unknown tools auto', async () => {
    const dir = await makeTempDir();
    const settingsFile = tempSettings('default-approve', dir);

    await fs.writeFile(
      settingsFile,
      JSON.stringify({ defaultAction: 'approve' }, null, 2),
      'utf-8',
    );

    const flow = new ApprovalFlow({ settingsPath: settingsFile });
    await flow.loadSettings();

    // unknown_tool is not in any default set → fallback to defaultAction
    const category = flow.categorize('unknown_tool', {});
    expect(category).toBe('auto');
  });

  it('defaultAction=deny makes unknown tools block', async () => {
    const dir = await makeTempDir();
    const settingsFile = tempSettings('default-deny', dir);

    await fs.writeFile(
      settingsFile,
      JSON.stringify({ defaultAction: 'deny' }, null, 2),
      'utf-8',
    );

    const flow = new ApprovalFlow({ settingsPath: settingsFile });
    await flow.loadSettings();

    const category = flow.categorize('unknown_tool', {});
    expect(category).toBe('block');
  });
});

describe('ApprovalFlow — autoApprovePatterns', () => {
  it('autoApprovePatterns regex auto-approves matching exec commands', async () => {
    const dir = await makeTempDir();
    const settingsFile = tempSettings('aap', dir);

    // Pattern matches 'git status' exactly but NOT 'git push' (which is an ask-pattern anyway)
    await fs.writeFile(
      settingsFile,
      JSON.stringify({ autoApprovePatterns: ['^exec: git status$'] }, null, 2),
      'utf-8',
    );

    const flow = new ApprovalFlow({ settingsPath: settingsFile });
    await flow.loadSettings();

    expect(flow.categorize('exec', { command: 'git status' })).toBe('auto');
    // 'git diff' doesn't match the pattern and isn't in DEFAULT_ASK_PATTERNS → ask (exec is ask by default)
    expect(flow.categorize('exec', { command: 'git diff' })).toBe('ask');
  });
});

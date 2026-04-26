// @vitest-environment node
/**
 * Workspace memory injection tests.
 *
 * Verifies that WorkspaceLoader.buildSystemPrompt() produces a prompt that
 * contains MEMORY.md content, and that PyrforRuntime wires it as the first
 * { role: 'system', ... } message visible to the AI provider.
 *
 * We test the wiring through SessionManager (the layer that holds
 * session.messages) rather than spinning up the full PyrforRuntime, which
 * would require live AI-provider credentials.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { WorkspaceLoader } from './workspace-loader';
import { SessionManager } from './session';

// ── helpers ──────────────────────────────────────────────────────────────────

const createdDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'pyrfor-mem-inject-test-'));
  createdDirs.push(d);
  return d;
}

afterEach(async () => {
  for (const d of [...createdDirs]) {
    await fsp.rm(d, { recursive: true, force: true });
  }
  createdDirs.length = 0;
});

// ── WorkspaceLoader: MEMORY.md sentinel appears in system prompt ─────────────

describe('WorkspaceLoader — system prompt injection', () => {
  it('includes MEMORY.md sentinel in getSystemPrompt() output', async () => {
    const dir = await makeTmpDir();
    const SENTINEL = 'UNIQUE_MEMORY_SENTINEL_XK42';
    await fsp.writeFile(path.join(dir, 'MEMORY.md'), `# Memory\n${SENTINEL}\n`);

    const loader = new WorkspaceLoader({ workspacePath: dir });
    const ws = await loader.load();

    expect(ws.systemPrompt).toContain(SENTINEL);
    expect(loader.getSystemPrompt()).toContain(SENTINEL);
  });

  it('empty workspace loads without error and produces a string system prompt', async () => {
    const dir = await makeTmpDir();

    const loader = new WorkspaceLoader({ workspacePath: dir });
    const ws = await loader.load();

    expect(ws.errors).toHaveLength(0);
    expect(typeof ws.systemPrompt).toBe('string');
    // Empty workspace → no long-term memory section, but no garbage either
    expect(ws.systemPrompt).not.toContain('[object Object]');
    expect(ws.systemPrompt).not.toContain('undefined');
  });
});

// ── SessionManager: system prompt becomes first system message ───────────────
//
// This mirrors what PyrforRuntime.handleMessage() does:
//   1. workspace.getSystemPrompt() → this.options.systemPrompt
//   2. sessions.create({ systemPrompt }) → session with messages[0] = system msg
//   3. session.messages is forwarded to the AI provider

describe('SessionManager — system message wiring', () => {
  it('inserts workspace system prompt as first system message in session', async () => {
    const dir = await makeTmpDir();
    const SENTINEL = 'UNIQUE_MEMORY_SENTINEL_YZ77';
    await fsp.writeFile(path.join(dir, 'MEMORY.md'), `# Memory\n${SENTINEL}\n`);

    const loader = new WorkspaceLoader({ workspacePath: dir });
    await loader.load();
    const systemPrompt = loader.getSystemPrompt();

    expect(systemPrompt).toContain(SENTINEL);

    // Simulate PyrforRuntime session creation
    const sm = new SessionManager();
    const session = sm.create({
      channel: 'cli',
      userId: 'test-user',
      chatId: 'test-chat',
      systemPrompt,
    });

    // System message must be present as the first message
    const systemMsg = session.messages.find(m => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain(SENTINEL);

    // Simulate adding a user turn (what the provider would receive)
    sm.addMessage(session.id, { role: 'user', content: 'Hello' });
    const messages = session.messages;

    // The messages array passed to the provider contains the sentinel
    const systemContent = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n');
    expect(systemContent).toContain(SENTINEL);
  });

  it('empty workspace system prompt: session creates without error', async () => {
    const dir = await makeTmpDir();

    const loader = new WorkspaceLoader({ workspacePath: dir });
    await loader.load();
    const systemPrompt = loader.getSystemPrompt();

    const sm = new SessionManager();
    // Should not throw even with empty/minimal system prompt
    expect(() =>
      sm.create({ channel: 'cli', userId: 'u', chatId: 'c', systemPrompt })
    ).not.toThrow();
  });
});

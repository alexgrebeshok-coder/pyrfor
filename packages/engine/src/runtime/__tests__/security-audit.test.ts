// @vitest-environment node
/**
 * Block A + E2: consolidated security audit — permissions, sandbox, worktree isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';

vi.mock('../../observability/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  writeFile as runtimeWriteFile,
  execCommand,
  executeRuntimeTool,
  configureRuntimePermissionEngine,
  getRuntimePermissionEngine,
  setSandboxProvider,
  setWorkspaceRoot,
} from '../tools';
import { createSandboxProvider } from '../sandbox';
import { SubagentSpawner } from '../subagents';
import { RuntimeWorktreeManager } from '../worktree/worktree-manager';
import { initTestGitRepo, removeTestGitRepo } from '../../test-utils/git-repo.js';

const execFileAsync = promisify(execFile);

const TESTS_TMP_BASE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__security_audit_tmp__',
);
const OUTSIDE_PATH = '/home/nonexistent-attacker-xyz/secret.txt';
const activeDirs: string[] = [];

async function makeSandbox(): Promise<string> {
  await fsp.mkdir(TESTS_TMP_BASE, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(TESTS_TMP_BASE, 'sandbox-'));
  activeDirs.push(dir);
  setWorkspaceRoot(dir);
  return dir;
}

describe('security audit — Block A', () => {
  beforeEach(() => {
    configureRuntimePermissionEngine({
      profile: 'autonomous',
      overrides: {
        exec: 'auto_allow',
        browser: 'auto_allow',
        process_spawn: 'auto_allow',
        process_kill: 'auto_allow',
      },
    });
    setSandboxProvider(null);
  });

  afterEach(async () => {
    configureRuntimePermissionEngine(null);
    setSandboxProvider(null);
    for (const d of activeDirs.splice(0)) {
      await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('A1 — permission bypass', () => {
    it('blocks write_file outside workspace under strict profile', async () => {
      const sandbox = await makeSandbox();
      configureRuntimePermissionEngine({ profile: 'strict', workspaceId: sandbox });

      const result = await executeRuntimeTool(
        'write_file',
        { path: OUTSIDE_PATH, content: 'evil' },
        { workspaceId: sandbox },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission denied|blocked/i);
    });

    it('blocks edit_file outside workspace under strict profile', async () => {
      const sandbox = await makeSandbox();
      configureRuntimePermissionEngine({ profile: 'strict', workspaceId: sandbox });

      const result = await executeRuntimeTool(
        'edit_file',
        { path: OUTSIDE_PATH, old_str: 'x', new_str: 'y' },
        { workspaceId: sandbox },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission denied|blocked/i);
    });

    it('blocks edit_file outside workspace via direct API', async () => {
      await makeSandbox();
      const result = await executeRuntimeTool('edit_file', {
        path: OUTSIDE_PATH,
        old_str: 'a',
        new_str: 'b',
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/blocked/i);
    });

    it('blocks write_file path traversal via executeRuntimeTool', async () => {
      const sandbox = await makeSandbox();
      const result = await executeRuntimeTool('write_file', {
        path: OUTSIDE_PATH,
        content: 'bypass',
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/blocked/i);
    });

    it.each([
      ['rm -rf /'],
      ['dd if=/dev/zero of=/dev/sda'],
      ['mkfs.ext4 /dev/sda1'],
    ])('blocks destructive exec: %s', async (command) => {
      const result = await execCommand(command);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/blocked/i);
    });

    it('requires ask_once approval and denies repeat without grant', async () => {
      const sandbox = await makeSandbox();
      configureRuntimePermissionEngine({ profile: 'standard', workspaceId: sandbox });
      const filePath = path.join(sandbox, 'ask-once-audit.txt');

      const first = await executeRuntimeTool(
        'write_file',
        { path: filePath, content: 'first' },
        { workspaceId: sandbox },
      );
      expect(first.success).toBe(false);
      expect(first.error).toMatch(/approval_required/i);

      const second = await executeRuntimeTool(
        'write_file',
        { path: filePath, content: 'second' },
        { workspaceId: sandbox },
      );
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/approval_required|permission denied/i);

      getRuntimePermissionEngine()?.recordApproval(sandbox, 'write_file');
      const third = await executeRuntimeTool(
        'write_file',
        { path: filePath, content: 'third' },
        { workspaceId: sandbox },
      );
      expect(third.success).toBe(true);
    });

    it('denies network tools when overrides set to deny', async () => {
      configureRuntimePermissionEngine({
        profile: 'strict',
        overrides: { web_fetch: 'deny', web_search: 'deny' },
      });

      const fetchResult = await executeRuntimeTool('web_fetch', { url: 'https://example.com' });
      const searchResult = await executeRuntimeTool('web_search', { query: 'test' });

      expect(fetchResult.success).toBe(false);
      expect(fetchResult.error).toMatch(/permission denied/i);
      expect(searchResult.success).toBe(false);
      expect(searchResult.error).toMatch(/permission denied/i);
    });

    it('does not auto-elevate subagent workspace permissions from parent approval', async () => {
      const sandbox = await makeSandbox();
      const subagentWorkspace = 'subagent:task-a';
      configureRuntimePermissionEngine({ profile: 'strict', workspaceId: sandbox });
      getRuntimePermissionEngine()?.recordApproval(sandbox, 'write_file');

      const parentAllowed = await executeRuntimeTool(
        'write_file',
        { path: path.join(sandbox, 'parent.txt'), content: 'ok' },
        { workspaceId: sandbox },
      );
      expect(parentAllowed.success).toBe(true);

      const subagentDenied = await executeRuntimeTool(
        'write_file',
        { path: path.join(sandbox, 'subagent.txt'), content: 'nope' },
        { workspaceId: subagentWorkspace },
      );
      expect(subagentDenied.success).toBe(false);
      expect(subagentDenied.error).toMatch(/permission denied|approval_required/i);

      const subagentExec = await executeRuntimeTool(
        'exec',
        { command: 'echo subagent' },
        { workspaceId: subagentWorkspace },
      );
      expect(subagentExec.success).toBe(false);
      expect(subagentExec.error).toMatch(/permission denied|approval_required/i);
    });

    it('SubagentSpawner tasks do not inherit parent exec approvals', async () => {
      const spawner = new SubagentSpawner(2);
      const spawned = spawner.spawn({
        task: 'audit isolation',
        parentSession: {
          id: 'parent-session',
          messages: [],
          systemPrompt: '',
          metadata: {},
        },
        execRoot: '/tmp/should-not-elevate',
      });
      expect(spawned.success).toBe(true);
      expect(spawner.getTask(spawned.taskId!)?.context.execRoot).toBe('/tmp/should-not-elevate');
    });
  });

  describe('A2 — sandbox integrity', () => {
    it('allows writes in workspace when sandbox provider is none', async () => {
      const workspace = await makeSandbox();
      setSandboxProvider(null);
      const target = path.join(workspace, 'none-sandbox.txt');
      const result = await runtimeWriteFile(target, 'allowed');
      expect(result.success).toBe(true);
    });

    it('blocks write outside execRoot under local-process sandbox', async () => {
      const workspace = await makeSandbox();
      const worktree = path.join(workspace, 'worktree');
      await fsp.mkdir(worktree, { recursive: true });
      setSandboxProvider(createSandboxProvider({ mode: 'local-process' }));

      const outside = path.join(workspace, 'outside.txt');
      const blocked = await runtimeWriteFile(outside, 'blocked', { execRoot: worktree });
      expect(blocked.success).toBe(false);
      expect(blocked.error).toMatch(/outside governed worktree/i);

      const inside = path.join(worktree, 'inside.txt');
      const ok = await runtimeWriteFile(inside, 'allowed', { execRoot: worktree });
      expect(ok.success).toBe(true);
    });

    it('scopes exec cwd to execRoot worktree', async () => {
      const sandbox = await makeSandbox();
      const nested = path.join(sandbox, 'nested');
      await fsp.mkdir(nested, { recursive: true });

      const result = await execCommand('pwd', { cwd: 'nested' }, { execRoot: sandbox });
      expect(result.success).toBe(true);
      expect(result.data.stdout.trim()).toBe(nested);
    });

    it('hot-switches sandbox provider without restart', async () => {
      const workspace = await makeSandbox();
      const worktree = path.join(workspace, 'wt');
      await fsp.mkdir(worktree, { recursive: true });
      const outside = path.join(workspace, 'hot-switch.txt');

      setSandboxProvider(null);
      expect((await runtimeWriteFile(outside, 'no-sandbox')).success).toBe(true);

      setSandboxProvider(createSandboxProvider({ mode: 'local-process' }));
      const blocked = await runtimeWriteFile(outside, 'with-sandbox', { execRoot: worktree });
      expect(blocked.success).toBe(false);

      setSandboxProvider(null);
      expect((await runtimeWriteFile(outside, 'restored')).success).toBe(true);
    });
  });
});

describe('security audit — Block E2 worktree', () => {
  let repoDir = '';
  let repoGitDir = '';
  let worktreeRoot = '';
  let manager: RuntimeWorktreeManager;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-security-wt-'));
    worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-security-wt-root-'));
    const { gitDir } = await initTestGitRepo(repoDir, { branch: 'main' });
    repoGitDir = gitDir;
    await writeFile(path.join(repoDir, 'note.txt'), 'base\n', 'utf8');
    await execFileAsync('git', ['add', '--', 'note.txt'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoDir });
    manager = new RuntimeWorktreeManager({
      getWorkspacePath: () => repoDir,
      rootDir: path.join(worktreeRoot, 'managed'),
    });
    setWorkspaceRoot(repoDir);
    setSandboxProvider(createSandboxProvider({ mode: 'local-process' }));
    configureRuntimePermissionEngine({
      profile: 'autonomous',
      overrides: { exec: 'auto_allow', write_file: 'auto_allow', edit_file: 'auto_allow' },
    });
  });

  afterEach(async () => {
    configureRuntimePermissionEngine(null);
    setSandboxProvider(null);
    await manager.cleanupAll().catch(() => {});
    await removeTestGitRepo(repoDir, repoGitDir);
    await rm(worktreeRoot, { recursive: true, force: true });
  });

  it('allows writeFile inside subagent worktree execRoot', async () => {
    const worktree = await manager.createForRun('subagent:task-a');
    const inside = path.join(worktree.path, 'worker.txt');
    const ok = await runtimeWriteFile(inside, 'worker data', { execRoot: worktree.path });
    expect(ok.success).toBe(true);
    expect(await readFile(inside, 'utf8')).toBe('worker data');
  });

  it('denies writeFile outside subagent worktree execRoot', async () => {
    const worktree = await manager.createForRun('subagent:task-a');
    const outside = path.join(repoDir, 'escape.txt');
    const blocked = await runtimeWriteFile(outside, 'escape', { execRoot: worktree.path });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/outside governed worktree|blocked/i);
  });

  it('cleans up worktree after manager.cleanupForRun', async () => {
    const worktree = await manager.createForRun('subagent:task-b');
    await manager.cleanupForRun('subagent:task-b');
    await expect(fsp.stat(worktree.path)).rejects.toThrow();
  });
});

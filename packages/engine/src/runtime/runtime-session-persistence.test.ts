// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeConfigSchema, type RuntimeConfig } from './config';
import { PyrforRuntime } from './index';
import type { Message } from '../ai/providers/base';

process.env['LOG_LEVEL'] = 'silent';

const roots: string[] = [];

function makeConfig(workspacePath: string): RuntimeConfig {
  const base = RuntimeConfigSchema.parse({});
  return {
    ...base,
    workspacePath,
    workspaceRoot: workspacePath,
    gateway: { ...base.gateway, enabled: false },
    cron: { enabled: false, timezone: 'UTC', jobs: [] },
    health: { enabled: false, intervalMs: 60_000 },
  };
}

async function tempDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

describe('PyrforRuntime session persistence', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('resolves default session root after config workspace and restores history across restart', async () => {
    const constructorWorkspace = await tempDir('pyrfor-constructor-workspace-');
    const configuredWorkspace = await tempDir('pyrfor-configured-workspace-');

    const runtimeA = new PyrforRuntime({
      workspacePath: constructorWorkspace,
      config: makeConfig(configuredWorkspace),
      persistence: { debounceMs: 1 },
    });
    vi.spyOn(runtimeA.providers, 'chat').mockResolvedValue('first reply');
    await runtimeA.start();
    const first = await runtimeA.handleMessage('web', 'user-1', 'chat-1', 'remember durable sessions');
    await runtimeA.stop();

    expect(first.sessionId).toBeTruthy();

    const runtimeB = new PyrforRuntime({
      workspacePath: constructorWorkspace,
      config: makeConfig(configuredWorkspace),
      persistence: { debounceMs: 1 },
    });
    const chatSpy = vi.spyOn(runtimeB.providers, 'chat').mockResolvedValue('second reply');
    await runtimeB.start();
    await runtimeB.handleMessage('web', 'user-1', 'chat-1', 'continue', { sessionId: first.sessionId });
    await runtimeB.stop();

    const [messages] = chatSpy.mock.calls[0] as [Message[]];
    expect(messages.map((message) => message.content)).toContain('remember durable sessions');
  });

  it('does not reuse a live session after switching workspaces', async () => {
    const workspaceA = await tempDir('pyrfor-workspace-a-');
    const workspaceB = await tempDir('pyrfor-workspace-b-');
    const runtime = new PyrforRuntime({
      workspacePath: workspaceA,
      config: makeConfig(workspaceA),
      persistence: { debounceMs: 1 },
    });
    const chatSpy = vi.spyOn(runtime.providers, 'chat').mockResolvedValue('reply');
    await runtime.start();
    const first = await runtime.handleMessage('web', 'user-1', 'chat-1', 'workspace a memory');

    await runtime.setWorkspacePath(workspaceB);
    chatSpy.mockClear();
    const second = await runtime.handleMessage('web', 'user-1', 'chat-1', 'workspace b message');
    await runtime.stop();

    expect(second.sessionId).not.toBe(first.sessionId);
    const [messages] = chatSpy.mock.calls[0] as [Message[]];
    expect(messages.map((message) => message.content)).not.toContain('workspace a memory');
  });

  it('reloads workspace memory after switching workspaces', async () => {
    const workspaceA = await tempDir('pyrfor-memory-a-');
    const workspaceB = await tempDir('pyrfor-memory-b-');
    await writeFile(path.join(workspaceA, 'MEMORY.md'), 'memory sentinel workspace A\n');
    await writeFile(path.join(workspaceB, 'MEMORY.md'), 'memory sentinel workspace B\n');

    const runtime = new PyrforRuntime({
      workspacePath: workspaceA,
      config: makeConfig(workspaceA),
      persistence: { debounceMs: 1 },
    });
    await runtime.start();
    expect(runtime.getMemorySnapshot().lines).toContain('memory sentinel workspace A');

    await runtime.setWorkspacePath(workspaceB);
    const lines = runtime.getMemorySnapshot().lines;
    await runtime.stop();

    expect(lines).toContain('memory sentinel workspace B');
    expect(lines).not.toContain('memory sentinel workspace A');
  });

  it('clears the previous workspace prompt when switching to an empty workspace', async () => {
    const workspaceA = await tempDir('pyrfor-prompt-a-');
    const workspaceB = await tempDir('pyrfor-prompt-b-');
    await writeFile(path.join(workspaceA, 'MEMORY.md'), 'prompt sentinel workspace A\n');

    const runtime = new PyrforRuntime({
      workspacePath: workspaceA,
      config: makeConfig(workspaceA),
      persistence: { debounceMs: 1 },
    });
    const chatSpy = vi.spyOn(runtime.providers, 'chat').mockResolvedValue('reply');
    await runtime.start();

    await runtime.setWorkspacePath(workspaceB);
    await runtime.handleMessage('web', 'user-1', 'chat-1', 'empty workspace message');
    await runtime.stop();

    const [messages] = chatSpy.mock.calls[0] as [Message[]];
    const systemPrompt = messages.find((message) => message.role === 'system')?.content ?? '';
    expect(systemPrompt).toContain('You are Pyrfor');
    expect(systemPrompt).not.toContain('prompt sentinel workspace A');
  });

  it('restores switched-workspace sessions by context without requiring sessionId', async () => {
    const workspaceA = await tempDir('pyrfor-restore-a-');
    const workspaceB = await tempDir('pyrfor-restore-b-');
    await mkdir(workspaceA, { recursive: true });
    await mkdir(workspaceB, { recursive: true });

    const runtimeA = new PyrforRuntime({
      workspacePath: workspaceA,
      config: makeConfig(workspaceA),
      persistence: { debounceMs: 1 },
    });
    vi.spyOn(runtimeA.providers, 'chat').mockResolvedValue('first reply');
    await runtimeA.start();
    await runtimeA.handleMessage('web', 'user-1', 'chat-1', 'persisted workspace switch memory');
    await runtimeA.stop();

    const runtimeB = new PyrforRuntime({
      workspacePath: workspaceB,
      config: makeConfig(workspaceB),
      persistence: { debounceMs: 1 },
    });
    const chatSpy = vi.spyOn(runtimeB.providers, 'chat').mockResolvedValue('second reply');
    await runtimeB.start();
    await runtimeB.setWorkspacePath(workspaceA);
    await runtimeB.handleMessage('web', 'user-1', 'chat-1', 'continue without explicit id');
    await runtimeB.stop();

    const [messages] = chatSpy.mock.calls[0] as [Message[]];
    expect(messages.map((message) => message.content)).toContain('persisted workspace switch memory');
  });
});

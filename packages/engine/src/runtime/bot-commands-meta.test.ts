// @vitest-environment node
/**
 * Tests for bot-commands-meta — setMyCommands payload management.
 */

import { describe, it, expect, vi } from 'vitest';
import { PYRFOR_COMMANDS, publishBotCommands } from './bot-commands-meta';
import type { BotCommandSpec, SetMyCommandsApi } from './bot-commands-meta';

// ─── PYRFOR_COMMANDS validation ───────────────────────────────────────────────

describe('PYRFOR_COMMANDS', () => {
  it('is exported and non-empty', () => {
    expect(Array.isArray(PYRFOR_COMMANDS)).toBe(true);
    expect(PYRFOR_COMMANDS.length).toBeGreaterThan(0);
  });

  it('all commands have valid length (1-32) and lowercase pattern', () => {
    for (const spec of PYRFOR_COMMANDS) {
      expect(spec.command.length).toBeGreaterThanOrEqual(1);
      expect(spec.command.length).toBeLessThanOrEqual(32);
      expect(/^[a-z0-9_]+$/.test(spec.command)).toBe(true);
    }
  });

  it('all descriptions are non-empty and ≤ 256 chars', () => {
    for (const spec of PYRFOR_COMMANDS) {
      expect(spec.description.length).toBeGreaterThanOrEqual(1);
      expect(spec.description.length).toBeLessThanOrEqual(256);
    }
  });
});

// ─── publishBotCommands — happy path ─────────────────────────────────────────

describe('publishBotCommands — default list', () => {
  function makeMockApi(): SetMyCommandsApi & { calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
      calls,
      async setMyCommands(cmds, opts) {
        calls.push([cmds, opts]);
      },
    };
  }

  it('calls setMyCommands at least 2 times (covers default + private + admin scopes)', async () => {
    const api = makeMockApi();
    await publishBotCommands(api);
    expect(api.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('calls setMyCommands 3 times for default PYRFOR_COMMANDS (3 scopes)', async () => {
    const api = makeMockApi();
    const result = await publishBotCommands(api);
    expect(api.calls.length).toBe(3);
    expect(result.scopesApplied).toBe(3);
  });

  it('default scope call contains start, help, about', async () => {
    const api = makeMockApi();
    await publishBotCommands(api);
    const defaultCall = api.calls.find(([, opts]) => (opts as { scope?: { type: string } })?.scope?.type === 'default');
    expect(defaultCall).toBeDefined();
    const cmds = (defaultCall as [Array<{ command: string }>, unknown])[0];
    const names = cmds.map((c) => c.command);
    expect(names).toContain('start');
    expect(names).toContain('help');
    expect(names).toContain('about');
  });

  it('all_private_chats scope call contains all 11 unique commands', async () => {
    const api = makeMockApi();
    await publishBotCommands(api);
    const privateCall = api.calls.find(([, opts]) => (opts as { scope?: { type: string } })?.scope?.type === 'all_private_chats');
    expect(privateCall).toBeDefined();
    const cmds = (privateCall as [Array<{ command: string }>, unknown])[0];
    expect(cmds.length).toBe(11);
  });

  it('all_chat_administrators scope contains skills, memory, status', async () => {
    const api = makeMockApi();
    await publishBotCommands(api);
    const adminCall = api.calls.find(([, opts]) => (opts as { scope?: { type: string } })?.scope?.type === 'all_chat_administrators');
    expect(adminCall).toBeDefined();
    const cmds = (adminCall as [Array<{ command: string }>, unknown])[0];
    const names = cmds.map((c) => c.command);
    expect(names).toContain('skills');
    expect(names).toContain('memory');
    expect(names).toContain('status');
  });

  it('passes languageCode to all API calls', async () => {
    const api = makeMockApi();
    await publishBotCommands(api, PYRFOR_COMMANDS, { languageCode: 'ru' });
    for (const [, opts] of api.calls) {
      expect((opts as { language_code?: string }).language_code).toBe('ru');
    }
  });

  it('returns correct total commands across all scopes', async () => {
    const api = makeMockApi();
    const result = await publishBotCommands(api);
    expect(result.total).toBe(PYRFOR_COMMANDS.length);
  });
});

// ─── publishBotCommands — validation ─────────────────────────────────────────

describe('publishBotCommands — validation', () => {
  const noopApi: SetMyCommandsApi = { async setMyCommands() {} };

  it('throws on uppercase command name', async () => {
    const cmds: BotCommandSpec[] = [{ command: 'Start', description: 'ok' }];
    await expect(publishBotCommands(noopApi, cmds)).rejects.toThrow(/Invalid command/);
  });

  it('throws on description > 256 chars', async () => {
    const cmds: BotCommandSpec[] = [{ command: 'start', description: 'x'.repeat(257) }];
    await expect(publishBotCommands(noopApi, cmds)).rejects.toThrow(/256/);
  });

  it('throws on command > 32 chars', async () => {
    const cmds: BotCommandSpec[] = [{ command: 'a'.repeat(33), description: 'ok' }];
    await expect(publishBotCommands(noopApi, cmds)).rejects.toThrow(/Invalid command/);
  });

  it('throws on empty command string', async () => {
    const cmds: BotCommandSpec[] = [{ command: '', description: 'ok' }];
    await expect(publishBotCommands(noopApi, cmds)).rejects.toThrow(/empty/);
  });
});

// ─── publishBotCommands — edge cases ─────────────────────────────────────────

describe('publishBotCommands — edge cases', () => {
  it('custom commands list overrides PYRFOR_COMMANDS', async () => {
    const calls: unknown[][] = [];
    const api: SetMyCommandsApi = {
      async setMyCommands(cmds, opts) { calls.push([cmds, opts]); },
    };
    const custom: BotCommandSpec[] = [
      { command: 'ping', description: 'Ping', scope: 'default' },
    ];
    const result = await publishBotCommands(api, custom);
    expect(calls.length).toBe(1);
    expect(result.total).toBe(1);
    const cmds = (calls[0] as [Array<{ command: string }>, unknown])[0];
    expect(cmds[0].command).toBe('ping');
  });

  it('API error on one scope does not prevent other scopes from being applied', async () => {
    let callCount = 0;
    const api: SetMyCommandsApi = {
      async setMyCommands(_cmds, opts) {
        callCount++;
        if ((opts as { scope?: { type: string } })?.scope?.type === 'default') {
          throw new Error('API error for default');
        }
      },
    };
    const result = await publishBotCommands(api);
    expect(callCount).toBe(3);
    expect(result.scopesApplied).toBe(2); // default failed, 2 others succeeded
  });

  it('scopesApplied count is correct on partial failure', async () => {
    const api: SetMyCommandsApi = {
      async setMyCommands(_cmds, opts) {
        if ((opts as { scope?: { type: string } })?.scope?.type === 'all_private_chats') {
          throw new Error('private chats scope failed');
        }
      },
    };
    const result = await publishBotCommands(api);
    expect(result.scopesApplied).toBe(2);
  });

  it('empty input → no API calls, returns {scopesApplied:0, total:0}', async () => {
    const calls: unknown[] = [];
    const api: SetMyCommandsApi = {
      async setMyCommands(cmds, opts) { calls.push([cmds, opts]); },
    };
    const result = await publishBotCommands(api, []);
    expect(calls.length).toBe(0);
    expect(result).toEqual({ scopesApplied: 0, total: 0 });
  });
});

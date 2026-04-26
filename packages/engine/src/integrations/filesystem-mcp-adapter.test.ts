// @vitest-environment node
/**
 * filesystem-mcp-adapter.test.ts — Unit tests for FilesystemMcpAdapter.
 *
 * All MCP I/O is replaced by a `vi.fn()` injected via `McpToolClientLike`.
 * No real filesystem access occurs anywhere in this suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FilesystemMcpAdapter,
  FilesystemAdapterError,
  SandboxViolationError,
  buildToolName,
  isInsideSandbox,
  parseReadFile,
  parseWriteFile,
  parseListDir,
  parseStat,
  type McpToolClientLike,
  type FilesystemAdapterOptions,
} from './filesystem-mcp-adapter';

// ====== Helpers ==============================================================

/** Build a minimal mock MCP client with a controllable `callTool`. */
function makeClient(impl?: (name: string, args: Record<string, unknown>) => Promise<unknown>): McpToolClientLike {
  return {
    callTool: vi.fn(impl ?? (() => Promise.resolve({}))),
  };
}

/** Build a minimal mock ledger that records every appended event. */
function makeLedger() {
  const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
  return {
    append: vi.fn((e: { kind: string; data: Record<string, unknown> }) => {
      events.push(e);
    }),
    events,
  };
}

const SANDBOX = '/workspace/project';

// ====== buildToolName ========================================================

describe('buildToolName', () => {
  it('concatenates prefix and action', () => {
    expect(buildToolName('fs_', 'readFile')).toBe('fs_readFile');
  });

  it('works with empty prefix', () => {
    expect(buildToolName('', 'stat')).toBe('stat');
  });
});

// ====== isInsideSandbox ======================================================

describe('isInsideSandbox', () => {
  it('returns true when root is undefined', () => {
    expect(isInsideSandbox('/any/path', undefined)).toBe(true);
  });

  it('returns true for path equal to root', () => {
    expect(isInsideSandbox('/foo/bar', '/foo/bar')).toBe(true);
  });

  it('returns true for path nested inside root', () => {
    expect(isInsideSandbox('/foo/bar/baz.txt', '/foo/bar')).toBe(true);
  });

  it('returns true for deeply nested path', () => {
    expect(isInsideSandbox('/foo/bar/a/b/c', '/foo/bar')).toBe(true);
  });

  it('rejects sibling-prefix false positive — /foo/barbaz does NOT match /foo/bar', () => {
    expect(isInsideSandbox('/foo/barbaz', '/foo/bar')).toBe(false);
  });

  it('rejects path entirely outside root', () => {
    expect(isInsideSandbox('/etc/passwd', '/workspace')).toBe(false);
  });

  it('normalises trailing separator in root', () => {
    expect(isInsideSandbox('/foo/bar/file.txt', '/foo/bar/')).toBe(true);
  });
});

// ====== parseReadFile ========================================================

describe('parseReadFile', () => {
  it('parses a valid response with all fields', () => {
    const result = parseReadFile({ path: '/a/b.txt', content: 'hello', encoding: 'utf8', bytes: 5 });
    expect(result).toEqual({ path: '/a/b.txt', content: 'hello', encoding: 'utf8', bytes: 5 });
  });

  it('defaults encoding to utf8 when not provided', () => {
    const result = parseReadFile({ path: '/f', content: 'x' });
    expect(result.encoding).toBe('utf8');
  });

  it('accepts base64 encoding', () => {
    const result = parseReadFile({ path: '/f', content: 'aGVsbG8=', encoding: 'base64', bytes: 5 });
    expect(result.encoding).toBe('base64');
  });

  it('defaults bytes to content.length when not provided', () => {
    const result = parseReadFile({ path: '/f', content: 'hello' });
    expect(result.bytes).toBe(5);
  });

  it('throws when response is not an object', () => {
    expect(() => parseReadFile('bad')).toThrow('parseReadFile: response is not an object');
  });

  it('throws when path is missing', () => {
    expect(() => parseReadFile({ content: 'hi' })).toThrow('parseReadFile: missing or invalid "path" field');
  });

  it('throws when content is missing', () => {
    expect(() => parseReadFile({ path: '/f' })).toThrow('parseReadFile: missing or invalid "content" field');
  });
});

// ====== parseWriteFile =======================================================

describe('parseWriteFile', () => {
  it('parses a valid response', () => {
    const result = parseWriteFile({ path: '/out.txt', bytesWritten: 42, created: true });
    expect(result).toEqual({ path: '/out.txt', bytesWritten: 42, created: true });
  });

  it('defaults created to false when not provided', () => {
    const result = parseWriteFile({ path: '/out.txt', bytesWritten: 10 });
    expect(result.created).toBe(false);
  });

  it('throws when response is not an object', () => {
    expect(() => parseWriteFile(null)).toThrow('parseWriteFile: response is not an object');
  });

  it('throws when path is missing', () => {
    expect(() => parseWriteFile({ bytesWritten: 5 })).toThrow('parseWriteFile: missing or invalid "path" field');
  });

  it('throws when bytesWritten is missing', () => {
    expect(() => parseWriteFile({ path: '/f' })).toThrow('parseWriteFile: missing or invalid "bytesWritten" field');
  });
});

// ====== parseListDir =========================================================

describe('parseListDir', () => {
  it('parses a valid response with entries', () => {
    const result = parseListDir({
      path: '/dir',
      entries: [
        { name: 'a.txt', kind: 'file', size: 100 },
        { name: 'sub', kind: 'dir' },
      ],
    });
    expect(result.path).toBe('/dir');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ name: 'a.txt', kind: 'file', size: 100 });
    expect(result.entries[1]).toEqual({ name: 'sub', kind: 'dir', size: undefined });
  });

  it('parses an empty entries array', () => {
    const result = parseListDir({ path: '/empty', entries: [] });
    expect(result.entries).toEqual([]);
  });

  it('throws when response is not an object', () => {
    expect(() => parseListDir(42)).toThrow('parseListDir: response is not an object');
  });

  it('throws when path is missing', () => {
    expect(() => parseListDir({ entries: [] })).toThrow('parseListDir: missing or invalid "path" field');
  });

  it('throws when entries is missing', () => {
    expect(() => parseListDir({ path: '/d' })).toThrow('parseListDir: missing or invalid "entries" field');
  });

  it('throws when an entry has an invalid kind', () => {
    expect(() =>
      parseListDir({ path: '/d', entries: [{ name: 'x', kind: 'unknown' }] }),
    ).toThrow('entries[0].kind is missing or invalid');
  });

  it('throws when an entry name is missing', () => {
    expect(() =>
      parseListDir({ path: '/d', entries: [{ kind: 'file' }] }),
    ).toThrow('entries[0].name is missing or invalid');
  });
});

// ====== parseStat ============================================================

describe('parseStat', () => {
  it('parses a valid response', () => {
    const result = parseStat({ path: '/f.txt', kind: 'file', size: 512, mtimeMs: 1700000000000 });
    expect(result).toEqual({ path: '/f.txt', kind: 'file', size: 512, mtimeMs: 1700000000000 });
  });

  it('throws when response is not an object', () => {
    expect(() => parseStat(undefined)).toThrow('parseStat: response is not an object');
  });

  it('throws when path is missing', () => {
    expect(() => parseStat({ kind: 'file', size: 0, mtimeMs: 0 })).toThrow('"path" field');
  });

  it('throws when kind is invalid', () => {
    expect(() => parseStat({ path: '/f', kind: 'socket', size: 0, mtimeMs: 0 })).toThrow('"kind" field');
  });

  it('throws when size is missing', () => {
    expect(() => parseStat({ path: '/f', kind: 'file', mtimeMs: 0 })).toThrow('"size" field');
  });

  it('throws when mtimeMs is missing', () => {
    expect(() => parseStat({ path: '/f', kind: 'file', size: 0 })).toThrow('"mtimeMs" field');
  });
});

// ====== FilesystemMcpAdapter — readFile ======================================

describe('FilesystemMcpAdapter.readFile', () => {
  it('calls the correct tool and returns parsed result', async () => {
    const client = makeClient(() =>
      Promise.resolve({ path: '/workspace/project/file.txt', content: 'hello', bytes: 5 }),
    );
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    const result = await adapter.readFile(`${SANDBOX}/file.txt`);

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_readFile',
      { path: `${SANDBOX}/file.txt` },
      expect.objectContaining({ timeoutMs: 10000 }),
    );
    expect(result.content).toBe('hello');
  });

  it('wraps client error in FilesystemAdapterError', async () => {
    const client = makeClient(() => Promise.reject(new Error('network down')));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.readFile(`${SANDBOX}/file.txt`)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof FilesystemAdapterError &&
        e.action === 'readFile' &&
        (e.cause as Error).message === 'network down',
    );
  });

  it('throws SandboxViolationError and does NOT call client', async () => {
    const client = makeClient();
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.readFile('/etc/passwd')).rejects.toBeInstanceOf(SandboxViolationError);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('passes encoding option to args', async () => {
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/f`, content: 'aGk=', encoding: 'base64', bytes: 2 }),
    );
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    await adapter.readFile(`${SANDBOX}/f`, { encoding: 'base64' });

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_readFile',
      { path: `${SANDBOX}/f`, encoding: 'base64' },
      expect.any(Object),
    );
  });
});

// ====== FilesystemMcpAdapter — writeFile =====================================

describe('FilesystemMcpAdapter.writeFile', () => {
  it('calls the correct tool and returns parsed result', async () => {
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/out.txt`, bytesWritten: 5, created: true }),
    );
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    const result = await adapter.writeFile(`${SANDBOX}/out.txt`, 'hello');

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_writeFile',
      { path: `${SANDBOX}/out.txt`, content: 'hello' },
      expect.any(Object),
    );
    expect(result.created).toBe(true);
    expect(result.bytesWritten).toBe(5);
  });

  it('wraps client error in FilesystemAdapterError', async () => {
    const client = makeClient(() => Promise.reject(new Error('disk full')));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.writeFile(`${SANDBOX}/f`, 'data')).rejects.toSatisfy(
      (e: unknown) => e instanceof FilesystemAdapterError && e.action === 'writeFile',
    );
  });

  it('throws SandboxViolationError and does NOT call client', async () => {
    const client = makeClient();
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.writeFile('/outside/path', 'x')).rejects.toBeInstanceOf(SandboxViolationError);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('passes createParents option to args', async () => {
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/deep/f`, bytesWritten: 1 }),
    );
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    await adapter.writeFile(`${SANDBOX}/deep/f`, 'x', { createParents: true });

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_writeFile',
      { path: `${SANDBOX}/deep/f`, content: 'x', createParents: true },
      expect.any(Object),
    );
  });
});

// ====== FilesystemMcpAdapter — listDir =======================================

describe('FilesystemMcpAdapter.listDir', () => {
  it('calls the correct tool and returns parsed result', async () => {
    const client = makeClient(() =>
      Promise.resolve({
        path: SANDBOX,
        entries: [{ name: 'readme.md', kind: 'file', size: 200 }],
      }),
    );
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    const result = await adapter.listDir(SANDBOX);

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_listDir',
      { path: SANDBOX },
      expect.any(Object),
    );
    expect(result.entries[0].name).toBe('readme.md');
  });

  it('wraps client error in FilesystemAdapterError', async () => {
    const client = makeClient(() => Promise.reject(new Error('no such dir')));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.listDir(SANDBOX)).rejects.toSatisfy(
      (e: unknown) => e instanceof FilesystemAdapterError && e.action === 'listDir',
    );
  });

  it('throws SandboxViolationError and does NOT call client', async () => {
    const client = makeClient();
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.listDir('/tmp/evil')).rejects.toBeInstanceOf(SandboxViolationError);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('passes recursive option to args', async () => {
    const client = makeClient(() => Promise.resolve({ path: SANDBOX, entries: [] }));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    await adapter.listDir(SANDBOX, { recursive: true });

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_listDir',
      { path: SANDBOX, recursive: true },
      expect.any(Object),
    );
  });
});

// ====== FilesystemMcpAdapter — stat ==========================================

describe('FilesystemMcpAdapter.stat', () => {
  it('calls the correct tool and returns parsed result', async () => {
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/f`, kind: 'file', size: 100, mtimeMs: 1000 }),
    );
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    const result = await adapter.stat(`${SANDBOX}/f`);

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_stat',
      { path: `${SANDBOX}/f` },
      expect.any(Object),
    );
    expect(result.kind).toBe('file');
    expect(result.size).toBe(100);
  });

  it('wraps client error in FilesystemAdapterError', async () => {
    const client = makeClient(() => Promise.reject(new Error('not found')));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.stat(`${SANDBOX}/f`)).rejects.toSatisfy(
      (e: unknown) => e instanceof FilesystemAdapterError && e.action === 'stat',
    );
  });

  it('throws SandboxViolationError and does NOT call client', async () => {
    const client = makeClient();
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.stat('/etc/shadow')).rejects.toBeInstanceOf(SandboxViolationError);
    expect(client.callTool).not.toHaveBeenCalled();
  });
});

// ====== FilesystemMcpAdapter — move ==========================================

describe('FilesystemMcpAdapter.move', () => {
  it('calls the correct tool and returns parsed result', async () => {
    const from = `${SANDBOX}/a.txt`;
    const to = `${SANDBOX}/b.txt`;
    const client = makeClient(() => Promise.resolve({ from, to }));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    const result = await adapter.move(from, to);

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_move',
      { from, to },
      expect.any(Object),
    );
    expect(result.from).toBe(from);
    expect(result.to).toBe(to);
  });

  it('wraps client error in FilesystemAdapterError', async () => {
    const client = makeClient(() => Promise.reject(new Error('locked')));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.move(`${SANDBOX}/a`, `${SANDBOX}/b`)).rejects.toSatisfy(
      (e: unknown) => e instanceof FilesystemAdapterError && e.action === 'move',
    );
  });

  it('throws SandboxViolationError when `from` is outside sandbox', async () => {
    const client = makeClient();
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.move('/outside/a', `${SANDBOX}/b`)).rejects.toBeInstanceOf(SandboxViolationError);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('throws SandboxViolationError when only `to` is outside sandbox', async () => {
    const client = makeClient();
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.move(`${SANDBOX}/a`, '/outside/b')).rejects.toBeInstanceOf(SandboxViolationError);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('passes overwrite option to args', async () => {
    const from = `${SANDBOX}/a`;
    const to = `${SANDBOX}/b`;
    const client = makeClient(() => Promise.resolve({ from, to }));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    await adapter.move(from, to, { overwrite: true });

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_move',
      { from, to, overwrite: true },
      expect.any(Object),
    );
  });
});

// ====== FilesystemMcpAdapter — delete ========================================

describe('FilesystemMcpAdapter.delete', () => {
  it('calls the correct tool and returns parsed result', async () => {
    const client = makeClient(() => Promise.resolve({ deleted: true }));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    const result = await adapter.delete(`${SANDBOX}/old.txt`);

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_delete',
      { path: `${SANDBOX}/old.txt` },
      expect.any(Object),
    );
    expect(result.deleted).toBe(true);
    expect(result.path).toBe(`${SANDBOX}/old.txt`);
  });

  it('wraps client error in FilesystemAdapterError', async () => {
    const client = makeClient(() => Promise.reject(new Error('permission denied')));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.delete(`${SANDBOX}/f`)).rejects.toSatisfy(
      (e: unknown) => e instanceof FilesystemAdapterError && e.action === 'delete',
    );
  });

  it('throws SandboxViolationError and does NOT call client', async () => {
    const client = makeClient();
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.delete('/etc/hosts')).rejects.toBeInstanceOf(SandboxViolationError);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('passes recursive option to args', async () => {
    const client = makeClient(() => Promise.resolve({ deleted: true }));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    await adapter.delete(`${SANDBOX}/dir`, { recursive: true });

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_delete',
      { path: `${SANDBOX}/dir`, recursive: true },
      expect.any(Object),
    );
  });
});

// ====== FilesystemMcpAdapter — mkdir =========================================

describe('FilesystemMcpAdapter.mkdir', () => {
  it('calls the correct tool and returns parsed result', async () => {
    const client = makeClient(() => Promise.resolve({ created: true }));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    const result = await adapter.mkdir(`${SANDBOX}/new`);

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_mkdir',
      { path: `${SANDBOX}/new` },
      expect.any(Object),
    );
    expect(result.created).toBe(true);
    expect(result.path).toBe(`${SANDBOX}/new`);
  });

  it('wraps client error in FilesystemAdapterError', async () => {
    const client = makeClient(() => Promise.reject(new Error('exists')));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.mkdir(`${SANDBOX}/new`)).rejects.toSatisfy(
      (e: unknown) => e instanceof FilesystemAdapterError && e.action === 'mkdir',
    );
  });

  it('throws SandboxViolationError and does NOT call client', async () => {
    const client = makeClient();
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });

    await expect(adapter.mkdir('/outside/new')).rejects.toBeInstanceOf(SandboxViolationError);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('passes recursive option to args', async () => {
    const client = makeClient(() => Promise.resolve({ created: true }));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    await adapter.mkdir(`${SANDBOX}/a/b/c`, { recursive: true });

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_mkdir',
      { path: `${SANDBOX}/a/b/c`, recursive: true },
      expect.any(Object),
    );
  });
});

// ====== Ledger integration ===================================================

describe('Ledger integration', () => {
  it('emits fs_action ok:true on successful readFile', async () => {
    const ledger = makeLedger();
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/f`, content: 'hi', bytes: 2 }),
    );
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX, ledger });
    await adapter.readFile(`${SANDBOX}/f`);

    expect(ledger.append).toHaveBeenCalledOnce();
    const event = ledger.events[0];
    expect(event.kind).toBe('fs_action');
    expect(event.data.action).toBe('readFile');
    expect(event.data.ok).toBe(true);
    expect(typeof event.data.durationMs).toBe('number');
  });

  it('emits fs_action ok:false when client throws', async () => {
    const ledger = makeLedger();
    const client = makeClient(() => Promise.reject(new Error('fail')));
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX, ledger });

    await expect(adapter.readFile(`${SANDBOX}/f`)).rejects.toBeInstanceOf(FilesystemAdapterError);

    expect(ledger.append).toHaveBeenCalledOnce();
    expect(ledger.events[0].data.ok).toBe(false);
  });

  it('emits sandbox_violation event when path escapes sandbox', async () => {
    const ledger = makeLedger();
    const client = makeClient();
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX, ledger });

    await expect(adapter.readFile('/etc/passwd')).rejects.toBeInstanceOf(SandboxViolationError);

    expect(ledger.append).toHaveBeenCalledOnce();
    const event = ledger.events[0];
    expect(event.data.ok).toBe(false);
    expect(event.data.reason).toBe('sandbox_violation');
  });

  it('does NOT throw when ledger is omitted', async () => {
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/f`, content: 'hi', bytes: 2 }),
    );
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    await expect(adapter.readFile(`${SANDBOX}/f`)).resolves.toBeDefined();
  });

  it('does NOT propagate ledger internal errors', async () => {
    const brokenLedger = { append: vi.fn(() => { throw new Error('ledger exploded'); }) };
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/f`, content: 'hi', bytes: 2 }),
    );
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX, ledger: brokenLedger });
    await expect(adapter.readFile(`${SANDBOX}/f`)).resolves.toBeDefined();
  });
});

// ====== AbortSignal propagation ==============================================

describe('AbortSignal propagation', () => {
  it('forwards signal to callTool', async () => {
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/f`, content: 'x', bytes: 1 }),
    );
    const adapter = new FilesystemMcpAdapter({ client, sandboxRoot: SANDBOX });
    const controller = new AbortController();

    await adapter.readFile(`${SANDBOX}/f`, { signal: controller.signal });

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_readFile',
      expect.any(Object),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

// ====== defaultTimeoutMs =====================================================

describe('defaultTimeoutMs', () => {
  it('uses defaultTimeoutMs when call-level timeoutMs is not supplied', async () => {
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/f`, content: 'x', bytes: 1 }),
    );
    const adapter = new FilesystemMcpAdapter({
      client,
      sandboxRoot: SANDBOX,
      defaultTimeoutMs: 42000,
    });
    await adapter.readFile(`${SANDBOX}/f`);

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_readFile',
      expect.any(Object),
      expect.objectContaining({ timeoutMs: 42000 }),
    );
  });

  it('call-level timeoutMs overrides defaultTimeoutMs', async () => {
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/f`, content: 'x', bytes: 1 }),
    );
    const adapter = new FilesystemMcpAdapter({
      client,
      sandboxRoot: SANDBOX,
      defaultTimeoutMs: 42000,
    });
    await adapter.readFile(`${SANDBOX}/f`, { timeoutMs: 500 });

    expect(client.callTool).toHaveBeenCalledWith(
      'fs_readFile',
      expect.any(Object),
      expect.objectContaining({ timeoutMs: 500 }),
    );
  });
});

// ====== Custom toolPrefix ====================================================

describe('toolPrefix option', () => {
  it('prepends custom prefix to tool names', async () => {
    const client = makeClient(() =>
      Promise.resolve({ path: `${SANDBOX}/f`, content: 'x', bytes: 1 }),
    );
    const adapter = new FilesystemMcpAdapter({
      client,
      sandboxRoot: SANDBOX,
      toolPrefix: 'mcp_fs_',
    });
    await adapter.readFile(`${SANDBOX}/f`);

    expect(client.callTool).toHaveBeenCalledWith(
      'mcp_fs_readFile',
      expect.any(Object),
      expect.any(Object),
    );
  });
});

// ====== Error class hierarchy ================================================

describe('Error class hierarchy', () => {
  it('FilesystemAdapterError has correct action and cause', () => {
    const cause = new Error('root cause');
    const err = new FilesystemAdapterError('readFile', 'wrapped', cause);
    expect(err.action).toBe('readFile');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('FilesystemAdapterError');
    expect(err).toBeInstanceOf(Error);
  });

  it('SandboxViolationError extends FilesystemAdapterError', () => {
    const err = new SandboxViolationError('stat', '/bad/path');
    expect(err).toBeInstanceOf(FilesystemAdapterError);
    expect(err).toBeInstanceOf(SandboxViolationError);
    expect(err.name).toBe('SandboxViolationError');
    expect(err.action).toBe('stat');
  });
});

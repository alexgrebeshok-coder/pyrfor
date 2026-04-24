// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';

// Must mock before importing the module under test so logger calls are silenced
vi.mock('../observability/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  readFile,
  writeFile,
  editFile,
  execCommand,
  webSearch,
  webFetch,
  executeRuntimeTool,
  setWorkspaceRoot,
  runtimeToolDefinitions,
} from './tools';

// ── Sandbox helpers ──────────────────────────────────────────────────────────

/** Parent dir for all per-test sandboxes (inside source tree, not /tmp). */
const TESTS_TMP_BASE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__tools_test_tmp__',
);

const activeDirs: string[] = [];

/** Create a fresh sandbox dir and register it as the workspace root. */
async function makeSandbox(): Promise<string> {
  await fsp.mkdir(TESTS_TMP_BASE, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(TESTS_TMP_BASE, 'sandbox-'));
  activeDirs.push(dir);
  setWorkspaceRoot(dir); // adds to module-level ALLOWED_ROOTS
  return dir;
}

afterEach(async () => {
  // Remove all sandbox dirs created this test
  for (const d of activeDirs.splice(0)) {
    await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  }
  // Restore any global stubs (fetch, etc.)
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.BRAVE_API_KEY;
});

// ── Paths guaranteed to be outside ALL registered ALLOWED_ROOTS ──────────────
const OUTSIDE_PATH = '/home/nonexistent-attacker-xyz/secret.txt';

// ── read_file ────────────────────────────────────────────────────────────────

describe('readFile', () => {
  it('happy path: returns file content', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'hello.txt');
    await fsp.writeFile(filePath, 'Hello, Pyrfor!', 'utf-8');

    const result = await readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.data.content).toBe('Hello, Pyrfor!');
    expect(result.data.size).toBeGreaterThan(0);
    expect(result.data.path).toBe(filePath);
  });

  it('rejects path traversal outside allowed roots', async () => {
    const result = await readFile(OUTSIDE_PATH);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
  });

  it('gracefully handles non-existent file', async () => {
    const sandbox = await makeSandbox();
    const result = await readFile(path.join(sandbox, 'does-not-exist.txt'));

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.data.content).toBe('');
  });

  it('returns empty string for empty file', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'empty.txt');
    await fsp.writeFile(filePath, '', 'utf-8');

    const result = await readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.data.content).toBe('');
    expect(result.data.size).toBe(0);
  });

  it('preserves unicode content', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'unicode.txt');
    const content = '日本語 🎉 Ünïcödé \u2603';
    await fsp.writeFile(filePath, content, 'utf-8');

    const result = await readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.data.content).toBe(content);
  });

  it('handles large text file (100 KB)', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'large.txt');
    const content = 'X'.repeat(100_000);
    await fsp.writeFile(filePath, content, 'utf-8');

    const result = await readFile(filePath);

    expect(result.success).toBe(true);
    expect(result.data.content.length).toBe(100_000);
    expect(result.data.size).toBe(100_000);
  });
});

// ── write_file ───────────────────────────────────────────────────────────────

describe('writeFile', () => {
  it('happy path: creates a new file', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'new.txt');

    const result = await writeFile(filePath, 'created');

    expect(result.success).toBe(true);
    expect(result.data.bytesWritten).toBeGreaterThan(0);
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('created');
  });

  it('creates intermediate parent directories automatically', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'a', 'b', 'deep.txt');

    const result = await writeFile(filePath, 'nested');

    expect(result.success).toBe(true);
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('nested');
  });

  it('overwrites an existing file', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'overwrite.txt');
    await fsp.writeFile(filePath, 'old content', 'utf-8');

    const result = await writeFile(filePath, 'new content');

    expect(result.success).toBe(true);
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('new content');
  });

  it('rejects path traversal outside allowed roots', async () => {
    const result = await writeFile(OUTSIDE_PATH, 'evil');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
  });

  it('returns error when parent dir is not writable', async () => {
    if (process.getuid?.() === 0) {
      // root can always write; skip this assertion
      return;
    }
    const sandbox = await makeSandbox();
    const readOnlyDir = path.join(sandbox, 'readonly-dir');
    await fsp.mkdir(readOnlyDir, { mode: 0o555 });

    const result = await writeFile(path.join(readOnlyDir, 'file.txt'), 'hello');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    // Restore permissions so afterEach cleanup can remove the dir
    await fsp.chmod(readOnlyDir, 0o755);
  });
});

// ── edit_file ────────────────────────────────────────────────────────────────

describe('editFile', () => {
  it('happy path: replaces a single occurrence', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'edit.txt');
    await fsp.writeFile(filePath, 'Hello World', 'utf-8');

    const result = await editFile(filePath, 'World', 'Pyrfor');

    expect(result.success).toBe(true);
    expect(result.data.replacements).toBe(1);
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('Hello Pyrfor');
  });

  it('returns error when old_str is not found', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'edit2.txt');
    await fsp.writeFile(filePath, 'Hello World', 'utf-8');

    const result = await editFile(filePath, 'NotPresent', 'Replacement');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    // File should be unchanged
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('Hello World');
  });

  it('replaces ALL occurrences when old_str appears multiple times', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'multi.txt');
    await fsp.writeFile(filePath, 'foo bar foo baz foo', 'utf-8');

    const result = await editFile(filePath, 'foo', 'qux');

    expect(result.success).toBe(true);
    expect(result.data.replacements).toBe(3);
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('qux bar qux baz qux');
  });
});

// ── exec ─────────────────────────────────────────────────────────────────────

describe('execCommand', () => {
  it('happy path: captures stdout', async () => {
    const result = await execCommand('echo hello');

    expect(result.success).toBe(true);
    expect(result.data.stdout.trim()).toBe('hello');
    expect(result.data.exitCode).toBe(0);
    expect(result.data.truncated).toBe(false);
  });

  it('captures non-zero exit code as failure', async () => {
    const result = await execCommand('sh -c "exit 42"');

    expect(result.success).toBe(false);
    expect(result.data.exitCode).toBe(42);
    expect(result.error).toBeTruthy();
  });

  it('is terminated after timeout and reports error', async () => {
    const result = await execCommand('sleep 10', { timeout: 150 });

    expect(result.success).toBe(false);
  }, 5000);

  it('blocks hardcoded dangerous commands', async () => {
    const result = await execCommand('rm -rf /');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/i);
  });

  it('captures stderr from failed command', async () => {
    const result = await execCommand('sh -c "echo oops >&2; exit 1"');

    expect(result.success).toBe(false);
    expect(result.data.stderr).toContain('oops');
  });
});

// ── web_search ───────────────────────────────────────────────────────────────

describe('webSearch', () => {
  beforeEach(() => {
    delete process.env.BRAVE_API_KEY;
  });

  it('happy path: returns DDG results when no Brave key set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        AbstractText: 'A description of the result.',
        AbstractURL: 'https://example.com/result',
        Heading: 'Result Heading',
        RelatedTopics: [
          { FirstURL: 'https://example.com/a', Text: 'Related A - related description' },
        ],
      })),
    }));

    const result = await webSearch('test query');

    expect(result.success).toBe(true);
    expect(result.data.results.length).toBeGreaterThan(0);
    expect(result.data.results[0].title).toBe('Result Heading');
    expect(result.data.results[0].url).toBe('https://example.com/result');
    expect(result.data.results[0].snippet).toContain('description');
  });

  it('uses Brave API when key is present', async () => {
    process.env.BRAVE_API_KEY = 'fake-brave-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        web: {
          results: [
            { title: 'Brave Result', url: 'https://brave.com/r1', description: 'Brave snippet' },
          ],
        },
      }),
    }));

    const result = await webSearch('brave query');

    expect(result.success).toBe(true);
    expect(result.data.results[0].title).toBe('Brave Result');
  });

  it('falls back to DDG when Brave returns empty results', async () => {
    process.env.BRAVE_API_KEY = 'fake-brave-key';
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Brave responds with empty results
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ web: { results: [] } }),
        });
      }
      // DDG fallback
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          AbstractText: 'DDG fallback result.',
          AbstractURL: 'https://ddg.gg',
          Heading: 'DDG Heading',
        })),
      });
    }));

    const result = await webSearch('empty-brave-query');

    expect(result.success).toBe(true);
    expect(result.data.results[0].title).toBe('DDG Heading');
  });

  it('returns error on 4xx from DDG', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    const result = await webSearch('rate limited');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

    const result = await webSearch('network error test');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network failure/i);
  });
});

// ── web_fetch ────────────────────────────────────────────────────────────────

describe('webFetch', () => {
  it('happy path: fetches HTML and converts to markdown', async () => {
    const html = [
      '<html><head><title>My Page</title></head>',
      '<body><h1>Hello</h1><p>World content here</p></body></html>',
    ].join('');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (_h: string) => 'text/html; charset=utf-8' },
      text: () => Promise.resolve(html),
    }));

    const result = await webFetch('https://example.com/page');

    expect(result.success).toBe(true);
    expect(result.data.title).toBe('My Page');
    expect(result.data.content).toContain('Hello');
    expect(result.data.contentType).toContain('text/html');
    expect(result.data.url).toBe('https://example.com/page');
  });

  it('returns plain text as-is for non-HTML content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (_h: string) => 'text/plain' },
      text: () => Promise.resolve('plain text content'),
    }));

    const result = await webFetch('https://example.com/plain.txt');

    expect(result.success).toBe(true);
    expect(result.data.content).toBe('plain text content');
  });

  it('returns error for 4xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await webFetch('https://example.com/404');

    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });

  it('returns error for 5xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const result = await webFetch('https://example.com/error');

    expect(result.success).toBe(false);
    expect(result.error).toContain('503');
  });

  it('gracefully handles network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    const result = await webFetch('https://unreachable.example');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/connection refused/i);
  });

  it('truncates content exceeding 50 000 characters', async () => {
    const longContent = 'A'.repeat(60_000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (_h: string) => 'text/plain' },
      text: () => Promise.resolve(longContent),
    }));

    const result = await webFetch('https://example.com/long');

    expect(result.success).toBe(true);
    expect(result.data.content).toContain('[truncated]');
    expect(result.data.content.length).toBeLessThan(60_000);
  });
});

// ── executeRuntimeTool — dispatcher ──────────────────────────────────────────

describe('executeRuntimeTool', () => {
  it('returns error for unknown tool name', async () => {
    const result = await executeRuntimeTool('nonexistent_tool', {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown tool/i);
  });

  it('returns error when required path arg is missing (read_file)', async () => {
    const result = await executeRuntimeTool('read_file', {});

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error when required command arg is missing (exec)', async () => {
    const result = await executeRuntimeTool('exec', {});

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error when required query arg is missing (web_search)', async () => {
    const result = await executeRuntimeTool('web_search', {});

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error when required url arg is missing (web_fetch)', async () => {
    const result = await executeRuntimeTool('web_fetch', {});

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('dispatches read_file and returns content', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'dispatch-read.txt');
    await fsp.writeFile(filePath, 'dispatched-read', 'utf-8');

    const result = await executeRuntimeTool('read_file', { path: filePath });

    expect(result.success).toBe(true);
    expect((result.data as { content: string }).content).toBe('dispatched-read');
  });

  it('dispatches write_file and creates the file', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'dispatch-write.txt');

    const result = await executeRuntimeTool('write_file', { path: filePath, content: 'via-dispatcher' });

    expect(result.success).toBe(true);
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('via-dispatcher');
  });

  it('dispatches edit_file', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'dispatch-edit.txt');
    await fsp.writeFile(filePath, 'before', 'utf-8');

    const result = await executeRuntimeTool('edit_file', {
      path: filePath,
      old_string: 'before',
      new_string: 'after',
    });

    expect(result.success).toBe(true);
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('after');
  });

  it('dispatches exec and returns stdout', async () => {
    const result = await executeRuntimeTool('exec', { command: 'echo dispatched' });

    expect(result.success).toBe(true);
    expect((result.data as { stdout: string }).stdout.trim()).toBe('dispatched');
  });
});

// ── readFile — additional edge cases ─────────────────────────────────────────

describe('readFile — edge cases', () => {
  it('returns error for a dangling symlink (target does not exist)', async () => {
    const sandbox = await makeSandbox();
    const symlinkPath = path.join(sandbox, 'dangling-link.txt');
    // Create symlink pointing to a non-existent file
    await fsp.symlink(path.join(sandbox, 'nonexistent-target.txt'), symlinkPath);

    const result = await readFile(symlinkPath);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error when a directory is passed instead of a file', async () => {
    const sandbox = await makeSandbox();

    // fs.readFile on a directory throws EISDIR
    const result = await readFile(sandbox);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('reads a binary file as a utf-8 string without throwing', async () => {
    const sandbox = await makeSandbox();
    const filePath = path.join(sandbox, 'binary.png');
    // Write PNG magic bytes + a few arbitrary binary bytes
    const binaryData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd,        // arbitrary binary
    ]);
    await fsp.writeFile(filePath, binaryData);

    const result = await readFile(filePath);

    // Implementation reads with 'utf-8'; binary → string with possible replacement chars
    expect(result.success).toBe(true);
    expect(typeof result.data.content).toBe('string');
    expect(result.data.size).toBe(binaryData.byteLength);
  });
});

// ── execCommand — additional edge cases ──────────────────────────────────────

describe('execCommand — edge cases', () => {
  it('truncates stdout that exceeds maxOutput and sets truncated=true', async () => {
    // Default maxOutput is 10 000; emit 15 000 chars
    const result = await execCommand(
      "node -e \"process.stdout.write('X'.repeat(15000))\"",
      { maxOutput: 10000 },
    );

    expect(result.success).toBe(true);
    expect(result.data.truncated).toBe(true);
    expect(result.data.stdout.length).toBeLessThanOrEqual(10000);
  });

  it('returns meaningful error for command not found (exit code 127)', async () => {
    // POSIX shells exit with 127 when the command binary is not found
    const result = await execCommand('nonexistentcommandxyz_copilot_test_abc');

    expect(result.success).toBe(false);
    expect(result.data.exitCode).toBe(127);
    // stderr from the shell should mention "not found" or "No such file"
    expect(result.data.stderr).toMatch(/not found|no such file/i);
  });
});

// ── webFetch — additional edge cases ─────────────────────────────────────────

describe('webFetch — edge cases', () => {
  it('returns error for an invalid URL (TypeError from fetch)', async () => {
    // Simulate what Node fetch throws for a URL without a protocol
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new TypeError('Failed to parse URL from not-a-valid-url'),
    ));

    const result = await webFetch('not-a-valid-url');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns content as string for binary response (image/png content-type)', async () => {
    // The implementation does not reject binary content-types; it calls response.text()
    // and returns whatever string results from the decoding.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (_h: string) => 'image/png' },
      text: () => Promise.resolve('\x89PNG\r\n\x1a\n'),
    }));

    const result = await webFetch('https://example.com/image.png');

    expect(result.success).toBe(true);
    expect(result.data.contentType).toBe('image/png');
    expect(typeof result.data.content).toBe('string');
  });
});

// ── webSearch — additional edge cases ────────────────────────────────────────

describe('webSearch — edge cases', () => {
  it('dispatcher returns error for empty query string', async () => {
    // executeRuntimeTool guards empty string before calling webSearch
    const result = await executeRuntimeTool('web_search', { query: '' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/query required/i);
  });

  it('webSearch called directly with empty string returns gracefully', async () => {
    // No BRAVE_API_KEY → falls through to DDG; empty query returns no results
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        AbstractText: '',
        AbstractURL: '',
        Heading: '',
        RelatedTopics: [],
      })),
    }));

    const result = await webSearch('');

    // No throw — result is either success=false (no results) or success=true (with results)
    expect(typeof result.success).toBe('boolean');
    expect(result.data).toBeDefined();
  });
});

// ── runtimeToolDefinitions schema ────────────────────────────────────────────

describe('runtimeToolDefinitions', () => {
  it('includes all expected tool names', () => {
    const names = runtimeToolDefinitions.map(t => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('exec');
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
  });

  it('every definition has name, description, and parameters.type=object', () => {
    for (const def of runtimeToolDefinitions) {
      expect(def.name, 'name').toBeTruthy();
      expect(def.description, 'description').toBeTruthy();
      expect(def.parameters.type).toBe('object');
    }
  });

  it('all declared required params exist in properties', () => {
    for (const def of runtimeToolDefinitions) {
      for (const req of def.parameters.required ?? []) {
        expect(
          def.parameters.properties,
          `${def.name}: required param '${req}' missing from properties`,
        ).toHaveProperty(req);
      }
    }
  });
});

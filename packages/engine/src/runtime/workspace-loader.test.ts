// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fsp } from 'fs';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  loadWorkspace,
  WorkspaceLoader,
  getDailyContext,
  searchMemory,
  type WorkspaceFiles,
} from './workspace-loader';

// ─── helpers ────────────────────────────────────────────────────────────────

const createdDirs: string[] = [];

/** Build a minimal WorkspaceFiles object for unit tests that don't need real fs */
function makeFiles(overrides: Partial<WorkspaceFiles> = {}): WorkspaceFiles {
  return {
    memory: '',
    daily: new Map(),
    soul: '',
    user: '',
    identity: '',
    agents: '',
    heartbeat: '',
    tools: '',
    skills: [],
    ...overrides,
  };
}

async function makeTmpDir(): Promise<string> {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'pyrfor-ws-test-'));
  createdDirs.push(d);
  return d;
}

afterEach(async () => {
  for (const d of [...createdDirs]) {
    await fsp.rm(d, { recursive: true, force: true });
  }
  createdDirs.length = 0;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('loadWorkspace', () => {
  it('1. happy path: all 3 core files present → system prompt contains all sections in order', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'SOUL.md'), 'Be kind and helpful.');
    await fsp.writeFile(path.join(dir, 'IDENTITY.md'), 'I am Pyrfor, an AI assistant.');
    await fsp.writeFile(path.join(dir, 'MEMORY.md'), 'User prefers concise answers.');

    const ws = await loadWorkspace(dir);
    const p = ws.systemPrompt;

    // All three sections present
    expect(p).toContain('# Identity');
    expect(p).toContain('I am Pyrfor, an AI assistant.');
    expect(p).toContain('# Core Values');
    expect(p).toContain('Be kind and helpful.');
    expect(p).toContain('# Long-term Memory');
    expect(p).toContain('User prefers concise answers.');

    // Identity appears before Core Values, Core Values before Long-term Memory
    expect(p.indexOf('# Identity')).toBeLessThan(p.indexOf('# Core Values'));
    expect(p.indexOf('# Core Values')).toBeLessThan(p.indexOf('# Long-term Memory'));
  });

  it('2. only SOUL.md present → only Core Values section in output', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'SOUL.md'), 'Curiosity is a virtue.');

    const ws = await loadWorkspace(dir);
    const p = ws.systemPrompt;

    expect(p).toContain('# Core Values');
    expect(p).toContain('Curiosity is a virtue.');
    expect(p).not.toContain('# Identity');
    expect(p).not.toContain('# Long-term Memory');
  });

  it('3. no files present → returns empty system prompt without throwing', async () => {
    const dir = await makeTmpDir();
    const ws = await loadWorkspace(dir);
    expect(ws.systemPrompt).toBe('');
    expect(ws.errors).toEqual([]);
  });

  it('4. empty file → section omitted (empty string is falsy)', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'SOUL.md'), '');
    await fsp.writeFile(path.join(dir, 'IDENTITY.md'), 'I am Pyrfor.');

    const ws = await loadWorkspace(dir);
    const p = ws.systemPrompt;

    // Empty SOUL.md → no Core Values section
    expect(p).not.toContain('# Core Values');
    // Non-empty IDENTITY.md → Identity section present
    expect(p).toContain('# Identity');
  });

  it('5. unicode content (Cyrillic + emoji) → preserved in system prompt', async () => {
    const dir = await makeTmpDir();
    const unicodeContent = 'Привет мир! 🌍 你好世界 こんにちは';
    await fsp.writeFile(path.join(dir, 'SOUL.md'), unicodeContent, 'utf-8');

    const ws = await loadWorkspace(dir);
    expect(ws.systemPrompt).toContain(unicodeContent);
  });

  it('6. BOM-prefixed file → BOM is preserved in content (Node.js fs does not strip BOM)', async () => {
    const dir = await makeTmpDir();
    const bom = '\uFEFF';
    const content = 'BOM content here.';
    await fsp.writeFile(path.join(dir, 'IDENTITY.md'), bom + content, 'utf-8');

    const ws = await loadWorkspace(dir);
    // Current code does not strip BOM — it appears in the loaded content
    expect(ws.files.identity).toContain(bom + content);
  });

  it('7. CRLF line endings → preserved as-is (no normalization)', async () => {
    const dir = await makeTmpDir();
    const crlfContent = 'line one\r\nline two\r\nline three';
    await fsp.writeFile(path.join(dir, 'SOUL.md'), crlfContent);

    const ws = await loadWorkspace(dir);
    // Code does not normalize CRLF; content preserved
    expect(ws.files.soul).toBe(crlfContent);
    expect(ws.systemPrompt).toContain('line one\r\nline two');
  });

  it('8. very long MEMORY.md (>1 MB) → loaded with truncation (first 5000 + last 5000 chars)', async () => {
    const dir = await makeTmpDir();
    // Build a string > 1MB
    const chunk = 'A'.repeat(1000);
    const bigContent = chunk.repeat(1100); // ~1.1 MB
    expect(bigContent.length).toBeGreaterThan(1_000_000);

    await fsp.writeFile(path.join(dir, 'MEMORY.md'), bigContent, 'utf-8');

    const ws = await loadWorkspace(dir);

    // The full content is stored in files.memory (no truncation there)
    expect(ws.files.memory.length).toBe(bigContent.length);

    // But the system prompt gets the 5000+5000 treatment
    expect(ws.systemPrompt).toContain('# Long-term Memory');
    expect(ws.systemPrompt).toContain('... [truncated] ...');
  });

  it('9. workspace dir does not exist → graceful: empty prompt, no throw', async () => {
    const nonExistent = path.join(os.tmpdir(), 'pyrfor-definitely-does-not-exist-' + Date.now());

    await expect(loadWorkspace(nonExistent)).resolves.not.toThrow();
    const ws = await loadWorkspace(nonExistent);

    expect(ws.systemPrompt).toBe('');
    expect(ws.errors).toEqual([]);
  });

  it('10. workspace path is a file, not a directory → graceful fallback, no throw', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, 'not-a-directory.txt');
    await fsp.writeFile(filePath, 'I am a file, not a directory.');

    await expect(loadWorkspace(filePath)).resolves.not.toThrow();
    const ws = await loadWorkspace(filePath);
    expect(ws.systemPrompt).toBe('');
  });
});

describe('WorkspaceLoader class', () => {
  it('getSystemPrompt returns empty string before load()', () => {
    const loader = new WorkspaceLoader({ workspacePath: '/nonexistent' });
    expect(loader.getSystemPrompt()).toBe('');
  });

  it('getWorkspace returns null before load()', () => {
    const loader = new WorkspaceLoader({ workspacePath: '/nonexistent' });
    expect(loader.getWorkspace()).toBeNull();
  });

  it('getWorkspace returns loaded workspace after load()', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'SOUL.md'), 'Test soul.');

    const loader = new WorkspaceLoader({ workspacePath: dir });
    await loader.load();

    const ws = loader.getWorkspace();
    expect(ws).not.toBeNull();
    expect(ws!.files.soul).toBe('Test soul.');
    expect(ws!.systemPrompt).toContain('# Core Values');
    expect(ws!.loadedAt).toBeInstanceOf(Date);

    loader.dispose();
  });

  it('reload() re-reads updated files', async () => {
    const dir = await makeTmpDir();
    const soulPath = path.join(dir, 'SOUL.md');
    await fsp.writeFile(soulPath, 'Original soul.');

    const loader = new WorkspaceLoader({ workspacePath: dir });
    await loader.load();
    expect(loader.getSystemPrompt()).toContain('Original soul.');

    await fsp.writeFile(soulPath, 'Updated soul.');
    await loader.reload();

    expect(loader.getSystemPrompt()).toContain('Updated soul.');
    loader.dispose();
  });

  it('maxPromptSize option truncates the system prompt', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'SOUL.md'), 'X'.repeat(500));
    await fsp.writeFile(path.join(dir, 'IDENTITY.md'), 'Y'.repeat(500));

    const loader = new WorkspaceLoader({ workspacePath: dir, maxPromptSize: 100 });
    await loader.load();

    const suffix = '\n\n... [context truncated due to size limit]';
    const prompt = loader.getSystemPrompt();
    expect(prompt.length).toBeLessThanOrEqual(100 + suffix.length);
    expect(prompt).toContain('... [context truncated due to size limit]');

    loader.dispose();
  });
});

describe('loadWorkspace: additional files', () => {
  it('USER.md appears as User Context section', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'USER.md'), 'User prefers dark mode.');

    const ws = await loadWorkspace(dir);
    expect(ws.systemPrompt).toContain('# User Context');
    expect(ws.systemPrompt).toContain('User prefers dark mode.');
  });

  it('TOOLS.md appears as Tool Capabilities section', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'TOOLS.md'), 'Tool: search, calendar.');

    const ws = await loadWorkspace(dir);
    expect(ws.systemPrompt).toContain('# Tool Capabilities');
    expect(ws.systemPrompt).toContain('Tool: search, calendar.');
  });

  it('SKILL.md file is discovered and loaded', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'SKILL.md'), 'Skill: TypeScript.');

    const ws = await loadWorkspace(dir);
    expect(ws.files.skills.length).toBeGreaterThan(0);
    expect(ws.files.skills.some(s => s.includes('Skill: TypeScript.'))).toBe(true);
  });

  it('daily memory file loaded for provided date', async () => {
    const dir = await makeTmpDir();
    const memDir = path.join(dir, 'memory');
    await fsp.mkdir(memDir);
    await fsp.writeFile(path.join(memDir, '2024-06-15.md'), 'Met with team today.');

    const ws = await loadWorkspace(dir, { date: '2024-06-15' });
    expect(ws.files.daily.get('2024-06-15')).toBe('Met with team today.');
    expect(ws.systemPrompt).toContain('# Recent Activity');
    expect(ws.systemPrompt).toContain('2024-06-15');
  });
});

// ─── New edge-case tests ──────────────────────────────────────────────────────

describe('WorkspaceLoader: edge cases', () => {
  it('symlink workspace dir → followed correctly', async () => {
    const realDir = await makeTmpDir();
    const linkParent = await makeTmpDir();
    const linkPath = path.join(linkParent, 'ws-link');

    await fsp.writeFile(path.join(realDir, 'SOUL.md'), 'From real dir via symlink.');
    await fsp.writeFile(path.join(realDir, 'IDENTITY.md'), 'Identity via symlink.');
    await fsp.symlink(realDir, linkPath);

    const ws = await loadWorkspace(linkPath);

    expect(ws.files.soul).toBe('From real dir via symlink.');
    expect(ws.files.identity).toBe('Identity via symlink.');
    expect(ws.systemPrompt).toContain('# Core Values');
    expect(ws.systemPrompt).toContain('# Identity');
  });

  it('whitespace-only file → truthy: section IS included in prompt', async () => {
    const dir = await makeTmpDir();
    // Whitespace string is truthy; buildSystemPrompt uses `if (files.soul)` which
    // passes for non-empty whitespace, so the section is included unchanged.
    const wsContent = '   \n\t\n   ';
    await fsp.writeFile(path.join(dir, 'SOUL.md'), wsContent);

    const ws = await loadWorkspace(dir);

    expect(ws.files.soul).toBe(wsContent);
    expect(ws.systemPrompt).toContain('# Core Values');
  });

  it('100 KB MEMORY.md → files.memory holds full content; systemPrompt applies 5000+5000 window', async () => {
    const dir = await makeTmpDir();
    // Construct a 100 000-char string with distinguishable start and end
    const startStr = 'START'.repeat(200);   // 1 000 chars
    const endStr   = 'ENDDD'.repeat(200);   // 1 000 chars
    const content  = startStr + 'M'.repeat(98_000) + endStr;
    expect(content.length).toBe(100_000);

    await fsp.writeFile(path.join(dir, 'MEMORY.md'), content, 'utf-8');

    const ws = await loadWorkspace(dir);

    // Raw content stored without truncation
    expect(ws.files.memory.length).toBe(100_000);

    // System prompt keeps first 5000 + '... [truncated] ...' + last 5000
    expect(ws.systemPrompt).toContain('# Long-term Memory');
    expect(ws.systemPrompt).toContain('... [truncated] ...');
    // Start characters are within the first 5000-char window
    expect(ws.systemPrompt).toContain(startStr.slice(0, 50));
    // End characters are within the last 5000-char window
    expect(ws.systemPrompt).toContain(endStr.slice(-50));
  });

  it('file with non-UTF-8 bytes → decoded with replacement characters, no throw', async () => {
    const dir = await makeTmpDir();
    // 0xFF is never a valid UTF-8 lead byte; Node.js replaces it with U+FFFD
    const buf = Buffer.concat([
      Buffer.from('Hello', 'ascii'),
      Buffer.from([0xff]),
      Buffer.from('World', 'ascii'),
    ]);
    await fsp.writeFile(path.join(dir, 'SOUL.md'), buf);

    const ws = await loadWorkspace(dir);

    // No throw; content is present
    expect(ws.files.soul).toBeTruthy();
    // ASCII parts preserved
    expect(ws.files.soul).toContain('Hello');
    expect(ws.files.soul).toContain('World');
    // Invalid byte replaced with Unicode replacement character
    expect(ws.files.soul).toContain('\uFFFD');
  });

  it('workspace dir read permissions denied → empty workspace, no throw', async () => {
    // chmod 000 is ineffective when running as root
    if (process.getuid && process.getuid() === 0) return;

    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'SOUL.md'), 'Hidden soul.');
    await fsp.chmod(dir, 0o000);

    try {
      // tryReadFile swallows EACCES (logs warn, returns ''), so prompt is empty
      const ws = await loadWorkspace(dir);
      expect(ws.systemPrompt).toBe('');
      expect(ws.errors).toEqual([]);
    } finally {
      // Restore permissions so afterEach cleanup can rm the directory
      await fsp.chmod(dir, 0o755);
    }
  });

  it('concurrent loads from same path → both succeed independently', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'SOUL.md'), 'Concurrent soul.');
    await fsp.writeFile(path.join(dir, 'IDENTITY.md'), 'Concurrent identity.');

    const [ws1, ws2] = await Promise.all([
      loadWorkspace(dir),
      loadWorkspace(dir),
    ]);

    expect(ws1.files.soul).toBe('Concurrent soul.');
    expect(ws2.files.soul).toBe('Concurrent soul.');
    expect(ws1.systemPrompt).toContain('# Identity');
    expect(ws2.systemPrompt).toContain('# Identity');
    // Independent LoadedWorkspace objects (no shared reference)
    expect(ws1).not.toBe(ws2);
  });

  it('no caching: successive load() calls always re-read from disk', async () => {
    const dir = await makeTmpDir();
    const soulPath = path.join(dir, 'SOUL.md');
    await fsp.writeFile(soulPath, 'Version 1.');

    const loader = new WorkspaceLoader({ workspacePath: dir });
    const ws1 = await loader.load();
    expect(ws1.files.soul).toBe('Version 1.');

    // Overwrite file, then call load() (not reload()) again
    await fsp.writeFile(soulPath, 'Version 2.');
    const ws2 = await loader.load();
    expect(ws2.files.soul).toBe('Version 2.');

    // Each call returns a fresh object
    expect(ws1).not.toBe(ws2);

    loader.dispose();
  });

  it('watch mode: file change triggers automatic reload', async () => {
    const dir = await makeTmpDir();
    const soulPath = path.join(dir, 'SOUL.md');
    await fsp.writeFile(soulPath, 'Watch initial.');

    const loader = new WorkspaceLoader({ workspacePath: dir, watch: true });
    await loader.load();
    expect(loader.getSystemPrompt()).toContain('Watch initial.');

    // Modify the watched file
    await fsp.writeFile(soulPath, 'Watch updated.');

    // Poll for up to 2 s — fs.watch on macOS is fast but not instantaneous
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
      if (loader.getSystemPrompt().includes('Watch updated.')) break;
    }

    expect(loader.getSystemPrompt()).toContain('Watch updated.');

    loader.dispose();
  }, 5000);
});

// ─── New tests targeting uncovered lines ─────────────────────────────────────

describe('getDailyContext (line 379)', () => {
  it('returns content when the date exists in the daily map', () => {
    const daily = new Map([['2024-06-15', 'Had a great standup.']]);
    const files = makeFiles({ daily });
    expect(getDailyContext(files, '2024-06-15')).toBe('Had a great standup.');
  });

  it('returns empty string when the date is absent from the daily map', () => {
    const files = makeFiles({ daily: new Map() });
    expect(getDailyContext(files, '2024-06-15')).toBe('');
  });
});

describe('searchMemory (lines 385-417)', () => {
  it('finds matches in memory, soul, user, and identity', () => {
    const files = makeFiles({
      memory: 'The quick brown fox.',
      soul: 'Brown bear attitude.',
      user: 'Brown hair preference.',
      identity: 'Known for brown eyes.',
    });
    const results = searchMemory(files, 'brown');
    expect(results).toHaveLength(4);
    const sources = results.map(r => r.source);
    expect(sources).toContain('MEMORY.md');
    expect(sources).toContain('SOUL.md');
    expect(sources).toContain('USER.md');
    expect(sources).toContain('IDENTITY.md');
    // Each snippet must include the matched word
    for (const r of results) {
      expect(r.snippet.toLowerCase()).toContain('brown');
    }
  });

  it('finds matches inside daily entries', () => {
    const daily = new Map([
      ['2024-01-15', 'Project kickoff meeting.'],
      ['2024-01-14', 'Routine sync, nothing special.'],
    ]);
    const files = makeFiles({ daily });
    const results = searchMemory(files, 'kickoff');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('memory/2024-01-15.md');
    expect(results[0].snippet).toContain('kickoff');
  });

  it('finds matches inside skills array', () => {
    const files = makeFiles({
      skills: ['TypeScript skill overview.', 'Python coding skill details.'],
    });
    const results = searchMemory(files, 'skill');
    expect(results).toHaveLength(2);
    const sources = results.map(r => r.source);
    expect(sources).toContain('SKILL-0.md');
    expect(sources).toContain('SKILL-1.md');
  });

  it('returns empty array when nothing matches', () => {
    const files = makeFiles({
      memory: 'Hello world.',
      soul: 'Be helpful.',
      skills: ['Some skill info.'],
    });
    expect(searchMemory(files, 'zyxwvutqrs')).toHaveLength(0);
  });

  it('snippet respects ±50-char context window', () => {
    const prefix = 'A'.repeat(60);
    const suffix = 'Z'.repeat(60);
    const files = makeFiles({ memory: prefix + 'TARGET' + suffix });
    const results = searchMemory(files, 'TARGET');
    expect(results).toHaveLength(1);
    const { snippet } = results[0];
    expect(snippet).toContain('TARGET');
    // Context window: up to 50 chars before + match length + up to 50 chars after
    expect(snippet.length).toBeLessThanOrEqual(50 + 'TARGET'.length + 50);
  });

  it('empty strings in all fields → no results', () => {
    const files = makeFiles(); // all empty
    expect(searchMemory(files, 'anything')).toHaveLength(0);
  });
});

describe('WorkspaceLoader watch: error paths (lines 330, 338)', () => {
  it('fsSync.watch throws on null-byte path → load() still resolves (covers catch at line 338)', async () => {
    // A null byte in the path is accepted by Node path.join/readFile (which return EINVAL,
    // swallowed by tryReadFile), but rejected synchronously by fsSync.watch's native layer,
    // so the catch block at line 338 fires while load() itself still succeeds.
    const badPath = '\0ceoclaw-invalid-watch-path';
    const loader = new WorkspaceLoader({ workspacePath: badPath, watch: true });
    const ws = await loader.load();
    expect(ws).toBeTruthy();
    expect(ws.errors).toEqual([]);
    loader.dispose();
  });

  it('reload() rejection inside watch callback is caught, process does not crash (covers line 330)', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, 'SOUL.md'), 'Initial soul.');

    const loader = new WorkspaceLoader({ workspacePath: dir, watch: true });
    await loader.load();

    // Make the next reload() call reject
    const reloadSpy = vi.spyOn(loader, 'reload').mockRejectedValueOnce(
      new Error('simulated reload failure'),
    );

    // Trigger the watcher callback by writing a .md file
    await fsp.writeFile(path.join(dir, 'SOUL.md'), 'Trigger change.');

    // Allow the async callback + error handler to run
    await new Promise(r => setTimeout(r, 600));

    // Test passes if we reach here without an unhandled rejection
    reloadSpy.mockRestore();
    loader.dispose();
  }, 5000);

  it('file removal in watch mode: reload reflects the deletion', async () => {
    const dir = await makeTmpDir();
    const soulPath = path.join(dir, 'SOUL.md');
    await fsp.writeFile(soulPath, 'Ephemeral soul.');

    const loader = new WorkspaceLoader({ workspacePath: dir, watch: true });
    await loader.load();
    expect(loader.getSystemPrompt()).toContain('Ephemeral soul.');

    // Remove the file — watcher fires 'rename' event
    await fsp.unlink(soulPath);

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
      if (!loader.getSystemPrompt().includes('Ephemeral soul.')) break;
    }

    expect(loader.getSystemPrompt()).not.toContain('Ephemeral soul.');
    loader.dispose();
  }, 5000);

  it('dispose() on a non-watching loader does not throw', () => {
    const loader = new WorkspaceLoader({ workspacePath: '/nonexistent' });
    expect(() => loader.dispose()).not.toThrow();
  });

  it('dispose() can be called multiple times without error', async () => {
    const dir = await makeTmpDir();
    const loader = new WorkspaceLoader({ workspacePath: dir, watch: true });
    await loader.load();
    loader.dispose();
    expect(() => loader.dispose()).not.toThrow();
  });
});

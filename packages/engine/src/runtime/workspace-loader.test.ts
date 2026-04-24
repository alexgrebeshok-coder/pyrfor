// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadWorkspace, WorkspaceLoader } from './workspace-loader';

// ─── helpers ────────────────────────────────────────────────────────────────

const createdDirs: string[] = [];

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

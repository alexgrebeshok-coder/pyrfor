// @vitest-environment node
/**
 * Tests for runtime/project-rules.ts — loadProjectRules + composeSystemPrompt.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadProjectRules, composeSystemPrompt } from '../project-rules';

// Silence logger
process.env['LOG_LEVEL'] = 'silent';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-rules-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── loadProjectRules ─────────────────────────────────────────────────────────

describe('loadProjectRules', () => {
  it('returns null when .pyrforrules does not exist', async () => {
    const result = await loadProjectRules(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null for empty workspace string', async () => {
    const result = await loadProjectRules('');
    expect(result).toBeNull();
  });

  it('returns trimmed content of .pyrforrules', async () => {
    await writeFile(path.join(tmpDir, '.pyrforrules'), '  Always use TypeScript.\n\n  ');
    const result = await loadProjectRules(tmpDir);
    expect(result).toBe('Always use TypeScript.');
  });

  it('returns content as-is (up to 16 KB)', async () => {
    const content = 'Use tabs for indentation.\nPrefer const over let.';
    await writeFile(path.join(tmpDir, '.pyrforrules'), content);
    const result = await loadProjectRules(tmpDir);
    expect(result).toBe(content);
  });

  it('truncates content at 16 KB', async () => {
    // Write exactly 16 KB + 1 byte extra
    const limit = 16 * 1024;
    const big = 'A'.repeat(limit) + 'EXTRA_THAT_SHOULD_NOT_APPEAR';
    await writeFile(path.join(tmpDir, '.pyrforrules'), big);
    const result = await loadProjectRules(tmpDir);
    expect(result).not.toBeNull();
    // The result must be at most 16 KB (trimEnd won't add chars)
    expect(Buffer.byteLength(result!, 'utf8')).toBeLessThanOrEqual(limit);
    expect(result).not.toContain('EXTRA_THAT_SHOULD_NOT_APPEAR');
  });

  it('returns null when file contains only whitespace', async () => {
    await writeFile(path.join(tmpDir, '.pyrforrules'), '   \n\n\t  ');
    const result = await loadProjectRules(tmpDir);
    expect(result).toBeNull();
  });
});

// ─── composeSystemPrompt ──────────────────────────────────────────────────────

describe('composeSystemPrompt', () => {
  it('returns base prompt unchanged when rules is null', () => {
    const base = 'You are a helpful assistant.';
    expect(composeSystemPrompt(base, null)).toBe(base);
  });

  it('returns base prompt unchanged when rules is empty string', () => {
    const base = 'You are a helpful assistant.';
    // loadProjectRules returns null for empty content, but test the function directly
    expect(composeSystemPrompt(base, '')).toBe(base);
  });

  it('appends rules under a clearly-marked separator', () => {
    const base = 'You are a helpful assistant.';
    const rules = 'Always use TypeScript.';
    const composed = composeSystemPrompt(base, rules);

    expect(composed).toContain(base);
    expect(composed).toContain(rules);
    // Rules must come after base
    expect(composed.indexOf(rules)).toBeGreaterThan(composed.indexOf(base));
    // There should be a separator between them
    expect(composed).toContain('---');
    expect(composed).toContain('Project Rules');
  });

  it('separator appears between base and rules', () => {
    const base = 'BASE';
    const rules = 'RULES';
    const composed = composeSystemPrompt(base, rules);

    const sepIdx = composed.indexOf('---');
    expect(sepIdx).toBeGreaterThan(0); // after base
    expect(composed.indexOf(rules)).toBeGreaterThan(sepIdx); // rules after separator
  });
});

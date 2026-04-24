// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';

import { parseSince, runExportTrajectories } from './cli.js';
import * as exportCliModule from './export-cli.js';

// ── Temp-dir helpers ───────────────────────────────────────────────────────

const TMP_BASE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__export_cli_runner_test_tmp__',
);

const cleanupDirs: string[] = [];

async function makeTestDir(label: string): Promise<string> {
  await fsp.mkdir(TMP_BASE, { recursive: true });
  const dir = path.join(
    TMP_BASE,
    label + '-' + Date.now() + '-' + Math.random().toString(36).slice(2),
  );
  await fsp.mkdir(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of cleanupDirs.splice(0)) {
    await fsp.rm(d, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

// ── parseSince unit tests ──────────────────────────────────────────────────

describe('parseSince', () => {
  it('parses 7d as 7 days ago (UTC midnight)', () => {
    const before = new Date();
    before.setUTCDate(before.getUTCDate() - 7);
    before.setUTCHours(0, 0, 0, 0);

    const result = parseSince('7d');

    const after = new Date();
    after.setUTCDate(after.getUTCDate() - 7);
    after.setUTCHours(0, 0, 0, 0);

    // Allow 1 ms tolerance for clock tick
    expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
    expect(result.getTime()).toBeLessThanOrEqual(after.getTime() + 1);
  });

  it('parses 30d as 30 days ago', () => {
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() - 30);
    expected.setUTCHours(0, 0, 0, 0);

    const result = parseSince('30d');
    expect(result.getTime()).toBeCloseTo(expected.getTime(), -2);
  });

  it('parses an ISO date string to exact Date', () => {
    const result = parseSince('2026-01-01T00:00:00Z');
    expect(result.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('throws on invalid input', () => {
    expect(() => parseSince('not-a-date')).toThrowError(/Invalid --since value/);
  });
});

// ── runExportTrajectories integration tests ────────────────────────────────

describe('runExportTrajectories', () => {
  it('throws (process.exit) when --out is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runExportTrajectories([])).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('throws (process.exit) on invalid --format', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(
      runExportTrajectories(['--out=x.jsonl', '--format=badformat']),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('happy path: calls exportTrajectoriesToFile with correct opts', async () => {
    const dir = await makeTestDir('happy-path');
    const outPath = path.join(dir, 'out.jsonl');

    // Stub exportTrajectoriesToFile to avoid needing real trajectory files
    const stub = vi
      .spyOn(exportCliModule, 'exportTrajectoriesToFile')
      .mockResolvedValue({ exported: 5, skipped: 1, outPath, formatUsed: 'sharegpt', bytes: 256 });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runExportTrajectories([
      `--out=${outPath}`,
      '--format=sharegpt',
      '--success-only',
      '--channel=telegram',
    ]);

    expect(stub).toHaveBeenCalledOnce();
    const calledWith = stub.mock.calls[0][0];
    expect(calledWith.outPath).toBe(outPath);
    expect(calledWith.format).toBe('sharegpt');
    expect(calledWith.successOnly).toBe(true);
    expect(calledWith.channel).toBe('telegram');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('✓ Exported 5 trajectories (1 skipped)'),
    );
  });

  it('--since=7d is parsed and forwarded as a Date', async () => {
    const dir = await makeTestDir('since-7d');
    const outPath = path.join(dir, 'out.jsonl');

    const stub = vi
      .spyOn(exportCliModule, 'exportTrajectoriesToFile')
      .mockResolvedValue({ exported: 0, skipped: 0, outPath, formatUsed: 'jsonl', bytes: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runExportTrajectories([`--out=${outPath}`, '--format=jsonl', '--since=7d']);

    const calledWith = stub.mock.calls[0][0];
    expect(calledWith.since).toBeInstanceOf(Date);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);
    // parseSince truncates to UTC midnight — allow 60s for any date-boundary edge case
    expect(Math.abs((calledWith.since as Date).getTime() - sevenDaysAgo.getTime())).toBeLessThan(
      60_000,
    );
  });

  it('--since=2026-01-01T00:00:00Z is forwarded as exact Date', async () => {
    const dir = await makeTestDir('since-iso');
    const outPath = path.join(dir, 'out.jsonl');

    const stub = vi
      .spyOn(exportCliModule, 'exportTrajectoriesToFile')
      .mockResolvedValue({ exported: 0, skipped: 0, outPath, formatUsed: 'jsonl', bytes: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runExportTrajectories([
      `--out=${outPath}`,
      '--format=jsonl',
      '--since=2026-01-01T00:00:00Z',
    ]);

    const calledWith = stub.mock.calls[0][0];
    expect((calledWith.since as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

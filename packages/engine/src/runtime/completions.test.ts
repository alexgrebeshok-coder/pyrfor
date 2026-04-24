// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

/** Returns the absolute path to a binary, or null if not found. */
function whichBinary(bin: string): string | null {
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const completionsDir = path.resolve(__dirname, '../../scripts/completions');
const bashPath = path.join(completionsDir, 'pyrfor-runtime.bash');
const zshPath  = path.join(completionsDir, 'pyrfor-runtime.zsh');
const fishPath = path.join(completionsDir, 'pyrfor-runtime.fish');

const bashScript = readFileSync(bashPath, 'utf8');
const zshScript  = readFileSync(zshPath,  'utf8');
const fishScript = readFileSync(fishPath, 'utf8');

// All known subcommand names that must appear in every completion file
const subcommands = [
  'service', 'install', 'uninstall', 'status',
  'migrate', 'sessions',
  'mcp',
  'backup', 'restore',
  'token', 'rotate',
];

// All known flags that must appear in every completion file
const flags = [
  '--telegram', '--port', '--workspace', '--config',
  '--out', '--force', '--label', '--ttl-days',
];

describe('pyrfor-runtime bash completion', () => {
  it('starts with bash shebang or bash completion header', () => {
    expect(bashScript.startsWith('#!/usr/bin/env bash') || bashScript.startsWith('# bash completion')).toBe(true);
  });

  it('registers the completion function with complete -F _pyrfor_runtime', () => {
    expect(bashScript).toContain('complete -F _pyrfor_runtime pyrfor-runtime');
  });

  for (const sub of subcommands) {
    it(`contains subcommand "${sub}"`, () => {
      expect(bashScript).toContain(sub);
    });
  }

  for (const flag of flags) {
    it(`contains flag "${flag}"`, () => {
      expect(bashScript).toContain(flag);
    });
  }

  it('is non-empty', () => {
    expect(bashScript.length).toBeGreaterThan(0);
  });

  it('backup subcommand suggests "list"', () => {
    expect(bashScript).toContain('list');
  });

  it('is plain ASCII with LF-only line endings and no BOM', () => {
    expect(bashScript.charCodeAt(0)).not.toBe(0xFEFF);
    expect(bashScript).not.toContain('\r');
    expect(/[^\x00-\x7F]/.test(bashScript)).toBe(false);
  });

  it('ends with a trailing newline', () => {
    expect(bashScript.endsWith('\n')).toBe(true);
  });

  it('reading the file twice returns identical content (idempotent)', () => {
    expect(readFileSync(bashPath, 'utf8')).toBe(bashScript);
  });

  it('has no bash syntax errors (bash -n)', () => {
    const bash = whichBinary('bash');
    if (bash) {
      const result = spawnSync(bash, ['-n', bashPath], { encoding: 'utf8' });
      expect(result.status).toBe(0);
    }
  });
});

describe('pyrfor-runtime zsh completion', () => {
  it('starts with #compdef pyrfor-runtime', () => {
    expect(zshScript.trimStart()).toMatch(/^#compdef pyrfor-runtime/);
  });

  for (const sub of subcommands) {
    it(`contains subcommand "${sub}"`, () => {
      expect(zshScript).toContain(sub);
    });
  }

  for (const flag of flags) {
    it(`contains flag "${flag}"`, () => {
      expect(zshScript).toContain(flag);
    });
  }

  it('is non-empty', () => {
    expect(zshScript.length).toBeGreaterThan(0);
  });

  it('backup subcommand suggests "list"', () => {
    expect(zshScript).toContain('list');
  });

  it('is plain ASCII with LF-only line endings and no BOM', () => {
    expect(zshScript.charCodeAt(0)).not.toBe(0xFEFF);
    expect(zshScript).not.toContain('\r');
    expect(/[^\x00-\x7F]/.test(zshScript)).toBe(false);
  });

  it('ends with a trailing newline', () => {
    expect(zshScript.endsWith('\n')).toBe(true);
  });

  it('reading the file twice returns identical content (idempotent)', () => {
    expect(readFileSync(zshPath, 'utf8')).toBe(zshScript);
  });

  it('has no zsh syntax errors (zsh -n)', () => {
    const zsh = whichBinary('zsh');
    if (zsh) {
      const result = spawnSync(zsh, ['-n', zshPath], { encoding: 'utf8' });
      expect(result.status).toBe(0);
    }
  });
});

describe('pyrfor-runtime fish completion', () => {
  it('contains "complete -c pyrfor-runtime"', () => {
    expect(fishScript).toContain('complete -c pyrfor-runtime');
  });

  for (const sub of subcommands) {
    it(`contains subcommand "${sub}"`, () => {
      expect(fishScript).toContain(sub);
    });
  }

  for (const flag of flags) {
    it(`contains flag "${flag.replace(/^--/, '')}"`, () => {
      // fish uses -l <flag-name> (without dashes), so strip the -- prefix for check
      expect(fishScript).toContain(flag.replace(/^--/, ''));
    });
  }

  it('is non-empty', () => {
    expect(fishScript.length).toBeGreaterThan(0);
  });

  it('backup subcommand suggests "list"', () => {
    expect(fishScript).toContain('list');
  });

  it('is plain ASCII with LF-only line endings and no BOM', () => {
    expect(fishScript.charCodeAt(0)).not.toBe(0xFEFF);
    expect(fishScript).not.toContain('\r');
    expect(/[^\x00-\x7F]/.test(fishScript)).toBe(false);
  });

  it('ends with a trailing newline', () => {
    expect(fishScript.endsWith('\n')).toBe(true);
  });

  it('reading the file twice returns identical content (idempotent)', () => {
    expect(readFileSync(fishPath, 'utf8')).toBe(fishScript);
  });

  it('has no fish syntax errors (fish -n)', () => {
    const fish = whichBinary('fish');
    if (fish) {
      const result = spawnSync(fish, ['-n', fishPath], { encoding: 'utf8' });
      expect(result.status).toBe(0);
    }
  });
});

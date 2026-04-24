// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const completionsDir = path.resolve(__dirname, '../../scripts/completions');

const bashScript = readFileSync(path.join(completionsDir, 'pyrfor-runtime.bash'), 'utf8');
const zshScript  = readFileSync(path.join(completionsDir, 'pyrfor-runtime.zsh'),  'utf8');
const fishScript = readFileSync(path.join(completionsDir, 'pyrfor-runtime.fish'), 'utf8');

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
});

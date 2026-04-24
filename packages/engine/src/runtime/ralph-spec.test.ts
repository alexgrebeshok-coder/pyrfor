// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseRalphMd, renderPrompt } from './ralph-spec.js';
import type { RalphSpec } from './ralph-spec.js';

const SAMPLE = `---
agent: freeclaude
task: Fix all TypeScript errors
maxIterations: 10
scoreThreshold: 75
exitToken: <promise>DONE</promise>
commands:
  tests: pnpm test
  lint: pnpm lint
  typecheck: npx tsc --noEmit
cwd: /workspace
env:
  NODE_ENV: test
  CI: "true"
scoring:
  tests: 60
  lint: 20
  typecheck: 20
---
# Task: {{ task }}

Run these commands:
- Tests: {{ commands.tests }}
- Lint: {{ commands.lint }}

Iteration: {{ iteration }}
Progress: {{ progress }}
Lessons: {{ lessons }}
`;

function minimalSpec(template: string, commands: Record<string, string> = {}): RalphSpec {
  return {
    agent: 'a',
    task: 't',
    maxIterations: 5,
    scoreThreshold: 80,
    promptTemplate: template,
    commands,
    exitToken: '<promise>COMPLETE</promise>',
  };
}

describe('parseRalphMd', () => {
  it('parses frontmatter + body', () => {
    const spec = parseRalphMd(SAMPLE);
    expect(spec.agent).toBe('freeclaude');
    expect(spec.task).toBe('Fix all TypeScript errors');
    expect(spec.commands.tests).toBe('pnpm test');
    expect(spec.commands.lint).toBe('pnpm lint');
    expect(spec.commands.typecheck).toBe('npx tsc --noEmit');
    expect(spec.promptTemplate).toContain('# Task: Fix all TypeScript errors');
  });

  it('applies default maxIterations=25', () => {
    const src = `---\nagent: a\ntask: do it\n---\nbody`;
    const spec = parseRalphMd(src);
    expect(spec.maxIterations).toBe(25);
  });

  it('applies default scoreThreshold=80', () => {
    const src = `---\nagent: a\ntask: do it\n---\nbody`;
    const spec = parseRalphMd(src);
    expect(spec.scoreThreshold).toBe(80);
  });

  it('applies default exitToken', () => {
    const src = `---\nagent: a\ntask: do it\n---\nbody`;
    const spec = parseRalphMd(src);
    expect(spec.exitToken).toBe('<promise>COMPLETE</promise>');
  });

  it('exitToken override respected', () => {
    const spec = parseRalphMd(SAMPLE);
    expect(spec.exitToken).toBe('<promise>DONE</promise>');
  });

  it('env + cwd parsed if present', () => {
    const spec = parseRalphMd(SAMPLE);
    expect(spec.cwd).toBe('/workspace');
    expect(spec.env).toEqual({ NODE_ENV: 'test', CI: 'true' });
  });

  it('scoring with tests/lint/typecheck parsed', () => {
    const spec = parseRalphMd(SAMPLE);
    expect(spec.scoring?.tests).toBe(60);
    expect(spec.scoring?.lint).toBe(20);
    expect(spec.scoring?.typecheck).toBe(20);
  });

  it('newlines preserved in body', () => {
    const spec = parseRalphMd(SAMPLE);
    expect(spec.promptTemplate.split('\n').length).toBeGreaterThan(3);
  });

  it('malformed YAML (no closing ---) → throws', () => {
    const bad = `---\nagent: a\ntask: do it\nbody body body`;
    expect(() => parseRalphMd(bad)).toThrow(/closing/);
  });

  it('missing required field task → throws', () => {
    const bad = `---\nagent: a\n---\nbody`;
    expect(() => parseRalphMd(bad)).toThrow(/task/);
  });
});

describe('renderPrompt', () => {
  it('substitutes {{ commands.tests }}', () => {
    const spec = minimalSpec('cmd: {{ commands.tests }}', { tests: 'pnpm test' });
    expect(renderPrompt(spec, { iteration: 1 })).toBe('cmd: pnpm test');
  });

  it('substitutes {{ iteration }}', () => {
    const spec = minimalSpec('iter={{ iteration }}');
    expect(renderPrompt(spec, { iteration: 7 })).toBe('iter=7');
  });

  it('substitutes {{ progress }}', () => {
    const spec = minimalSpec('p:{{ progress }}');
    expect(renderPrompt(spec, { iteration: 1, progress: 'doing' })).toBe('p:doing');
  });

  it('substitutes {{ lessons }}', () => {
    const spec = minimalSpec('L:{{ lessons }}');
    expect(renderPrompt(spec, { iteration: 1, lessons: 'remember' })).toBe('L:remember');
  });

  it('missing commands placeholder → empty string', () => {
    const spec = minimalSpec('x={{ commands.nope }}');
    expect(renderPrompt(spec, { iteration: 1 })).toBe('x=');
  });

  it('lastScore substituted when provided', () => {
    const spec = minimalSpec('s={{ lastScore }}');
    expect(renderPrompt(spec, { iteration: 1, lastScore: 42 })).toBe('s=42');
  });

  it('verifyResults substituted when lastVerify provided', () => {
    const spec = minimalSpec('V:{{ verifyResults }}');
    const out = renderPrompt(spec, {
      iteration: 1,
      lastVerify: {
        total: 50,
        threshold: 80,
        passed: false,
        ts: 0,
        checks: [
          {
            name: 'tests',
            passed: false,
            score: 0,
            stdout: '',
            stderr: '',
            exitCode: 1,
            durationMs: 0,
          },
        ],
      },
    });
    expect(out).toContain('total=50');
    expect(out).toContain('tests');
  });
});

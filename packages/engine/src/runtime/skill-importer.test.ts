import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from './artifact-model';
import {
  approveSkillRegistryEntry,
  importSkillMdToRegistry,
  testSkillRegistryEntry,
} from './skill-importer';
import { createToolRegistry } from './universal/tool-registry';

describe('skill importer governance flow', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('tests and approves an imported skill through governed registry states', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pyrfor-skill-importer-'));
    roots.push(root);
    const registry = createToolRegistry(path.join(root, 'registry'));
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });

    const imported = importSkillMdToRegistry(registry, {
      sourceLabel: '/Users/aleksandrgrebeshok/private/skills/research/SKILL.md',
      content: [
        '---',
        'name: Research Helper',
        'description: Gather governed evidence',
        'trigger: research, evidence',
        '---',
        'Use careful evidence gathering.',
      ].join('\n'),
    });

    const tested = await testSkillRegistryEntry(registry, imported.entry.id, { artifactStore });
    expect(tested).toMatchObject({
      schemaVersion: 'pyrfor.skill_test.v1',
      passed: true,
      failureScore: 0,
      entry: {
        id: imported.entry.id,
        status: 'pending_validation',
        quality: {
          testsPassed: true,
          approvalRequired: true,
        },
      },
    });
    expect(tested.testResultArtifactId).toMatch(/\.json$/);

    const approved = approveSkillRegistryEntry(registry, imported.entry.id);
    expect(approved).toMatchObject({
      schemaVersion: 'pyrfor.skill_approval.v1',
      approved: true,
      alreadyApproved: false,
      promotedFrom: 'pending_validation',
      promotedTo: 'vetted',
      entry: {
        id: imported.entry.id,
        status: 'vetted',
        tags: expect.arrayContaining(['state:vetted']),
        quality: {
          testsPassed: true,
          approvalRequired: false,
          provenanceTrust: 'vetted',
        },
        capability: {
          requiredTrustTier: 'vetted',
        },
      },
    });
    expect(approved.entry.tags).not.toContain('state:quarantined');
  });

  it('blocks approval before a skill has passed validation', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pyrfor-skill-importer-'));
    roots.push(root);
    const registry = createToolRegistry(path.join(root, 'registry'));

    const imported = importSkillMdToRegistry(registry, {
      content: ['---', 'name: Release Helper', 'description: Prepare release notes', 'trigger: release', '---', 'Write release summary.'].join('\n'),
    });

    expect(() => approveSkillRegistryEntry(registry, imported.entry.id)).toThrow('skill_tests_required');
  });

  it('records failed validation when an imported skill drifts outside governed constraints', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pyrfor-skill-importer-'));
    roots.push(root);
    const registry = createToolRegistry(path.join(root, 'registry'));

    const imported = importSkillMdToRegistry(registry, {
      content: ['---', 'name: Build Helper', 'description: Build safely', 'trigger: build', '---', 'Run safe build steps.'].join('\n'),
    });

    registry.update(imported.entry.id, (current) => ({
      ...current,
      capability: {
        ...current.capability,
        requiredSandboxTier: 'host',
      },
    }));

    const tested = await testSkillRegistryEntry(registry, imported.entry.id);
    expect(tested.passed).toBe(false);
    expect(tested.failureScore).toBeGreaterThan(0);
    expect(tested.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'skill-sandbox-tier', passed: false }),
    ]));
    expect(() => approveSkillRegistryEntry(registry, imported.entry.id)).toThrow('skill_validation_failed');
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSkillsLibrary, type Skill } from './skills-library';
import { listSkillCatalog, recommendSkillsPreview } from './skill-inspector';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  const skill: Skill = {
    id: overrides.id ?? 'test-skill',
    name: overrides.name ?? 'Test Skill',
    description: overrides.description ?? 'Helps test skill inspector output.',
    whenToUse: overrides.whenToUse ?? ['when testing inspector'],
    systemPrompt: overrides.systemPrompt ?? 'Never expose this raw prompt.',
    steps: overrides.steps ?? ['Inspect', 'Report'],
    examples: overrides.examples ?? [{ input: 'test', output: 'result' }],
    tags: overrides.tags ?? ['testing'],
  };
  if (overrides.estimatedTokens !== undefined) skill.estimatedTokens = overrides.estimatedTokens;
  return skill;
}

describe('skill inspector', () => {
  it('returns metadata-only sorted skill catalog without raw system prompts', () => {
    const library = createSkillsLibrary([
      makeSkill({ id: 'zeta', systemPrompt: 'secret zeta prompt' }),
      makeSkill({ id: 'alpha', systemPrompt: 'secret alpha prompt' }),
    ]);

    const catalog = listSkillCatalog(library);
    const serialized = JSON.stringify(catalog);

    expect(catalog.total).toBe(2);
    expect(catalog.skills.map((skill) => skill.id)).toEqual(['alpha', 'zeta']);
    expect(catalog.skills[0]).toMatchObject({
      id: 'alpha',
      stepsCount: 2,
      examplesCount: 1,
      systemPromptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(serialized).not.toContain('secret alpha prompt');
    expect(serialized).not.toContain('secret zeta prompt');
  });

  it('returns bounded deterministic recommendations', () => {
    const library = createSkillsLibrary([
      makeSkill({ id: 'debug', name: 'Debug', whenToUse: ['typescript error'], tags: ['debug'] }),
      makeSkill({ id: 'write-docs', name: 'Docs', whenToUse: ['documentation'], tags: ['docs'] }),
    ]);

    const result = recommendSkillsPreview({ task: 'Fix a TypeScript error', limit: 50 }, library);

    expect(result.limit).toBe(10);
    expect(result.recommendations[0]?.id).toBe('debug');
    expect(JSON.stringify(result)).not.toContain('Never expose this raw prompt');
  });

  it('rejects empty and oversized task input', () => {
    expect(() => recommendSkillsPreview({ task: '   ' })).toThrow('invalid_skill_task');
    expect(() => recommendSkillsPreview({ task: 'x'.repeat(2_001) })).toThrow('skill_task_too_long');
  });
});

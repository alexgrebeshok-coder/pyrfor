// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSkillMd } from '../skill-md-parser';
import { registerDynamicSkills, skillsRegistry } from '../index';

// ─── parseSkillMd tests ──────────────────────────────────────────────────────

describe('parseSkillMd', () => {
  it('parses a valid SKILL.md with all frontmatter fields', () => {
    const raw = `---
name: my-skill
description: Does X really well
trigger: x-keyword another
icon: 🛠️
category: analysis
parameters:
  - name: input, type: string
---
You are an expert at X. Process the user request carefully.`;

    const result = parseSkillMd(raw, 'skills/my-skill.md');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-skill');
    expect(result!.description).toBe('Does X really well');
    expect(result!.trigger).toBe('x-keyword another');
    expect(result!.icon).toBe('🛠️');
    expect(result!.category).toBe('analysis');
    expect(result!.prompt).toBe('You are an expert at X. Process the user request carefully.');
    expect(result!.sourcePath).toBe('skills/my-skill.md');
  });

  it('returns null and warns when frontmatter delimiters are missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = 'Just plain markdown without frontmatter.';

    const result = parseSkillMd(raw);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Missing frontmatter'));
    warnSpy.mockRestore();
  });

  it('returns null and warns when name field is absent', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = `---
description: No name here
---
Prompt body.`;

    const result = parseSkillMd(raw);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"name"'));
    warnSpy.mockRestore();
  });

  it('extracts body correctly when frontmatter is multi-line', () => {
    const raw = `---
name: multi-line
description: line one
trigger: trigger-kw
---
Line 1 of body.
Line 2 of body.
Line 3 of body.`;

    const result = parseSkillMd(raw);
    expect(result).not.toBeNull();
    expect(result!.prompt).toBe('Line 1 of body.\nLine 2 of body.\nLine 3 of body.');
  });

  it('works without optional fields', () => {
    const raw = `---
name: minimal-skill
---
Just a prompt.`;

    const result = parseSkillMd(raw);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('minimal-skill');
    expect(result!.description).toBe('');
    expect(result!.trigger).toBeUndefined();
    expect(result!.icon).toBeUndefined();
    expect(result!.prompt).toBe('Just a prompt.');
  });
});

// ─── registerDynamicSkills tests ─────────────────────────────────────────────

const sampleA = `---
name: skill-alpha
description: Alpha skill
trigger: alpha
category: productivity
---
You are Alpha.`;

const sampleB = `---
name: skill-beta
description: Beta skill
trigger: beta
category: analysis
---
You are Beta.`;

describe('registerDynamicSkills', () => {
  beforeEach(() => {
    // Remove any previously registered dynamic skills to keep tests isolated
    const toRemove = skillsRegistry
      .map((s, i) => (s.id.startsWith('user:') ? i : -1))
      .filter((i) => i >= 0)
      .reverse();
    for (const idx of toRemove) {
      skillsRegistry.splice(idx, 1);
    }
  });

  it('registers two skills and returns count 2', () => {
    const count = registerDynamicSkills([sampleA, sampleB]);
    expect(count).toBe(2);
  });

  it('registered skills are queryable from skillsRegistry', () => {
    registerDynamicSkills([sampleA, sampleB]);

    const alpha = skillsRegistry.find((s) => s.id === 'user:skill-alpha');
    const beta = skillsRegistry.find((s) => s.id === 'user:skill-beta');

    expect(alpha).toBeDefined();
    expect(alpha!.name).toBe('skill-alpha');
    expect(alpha!.category).toBe('productivity');

    expect(beta).toBeDefined();
    expect(beta!.name).toBe('skill-beta');
    expect(beta!.category).toBe('analysis');
  });

  it('skill validate() matches by keyword', () => {
    registerDynamicSkills([sampleA]);
    const skill = skillsRegistry.find((s) => s.id === 'user:skill-alpha')!;
    expect(skill.validate?.({ query: 'run alpha now' })).toBe(true);
    expect(skill.validate?.({ query: 'unrelated query' })).toBe(false);
  });

  it('skill execute() returns placeholder when no AI provider is set', async () => {
    registerDynamicSkills([sampleA]);
    const skill = skillsRegistry.find((s) => s.id === 'user:skill-alpha')!;
    const output = await skill.execute({ query: 'hello' });
    expect(output.success).toBe(true);
    expect(output.result).toContain('skill-alpha');
  });

  it('re-registering a skill replaces the existing entry', () => {
    registerDynamicSkills([sampleA]);
    const countBefore = skillsRegistry.filter((s) => s.id === 'user:skill-alpha').length;

    registerDynamicSkills([sampleA]);
    const countAfter = skillsRegistry.filter((s) => s.id === 'user:skill-alpha').length;

    expect(countBefore).toBe(1);
    expect(countAfter).toBe(1);
  });

  it('skips malformed entries and returns correct count', () => {
    const bad = 'no frontmatter at all';
    const count = registerDynamicSkills([bad, sampleB]);
    expect(count).toBe(1);
    expect(skillsRegistry.find((s) => s.id === 'user:skill-beta')).toBeDefined();
  });
});

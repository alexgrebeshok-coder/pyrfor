/**
 * pyrfor-pattern-to-skill.ts — Thin connector: mined patterns → FC skills.
 */

import type { FcSkill } from './pyrfor-fc-skill-writer';
import type { SkillWriter } from './pyrfor-fc-skill-writer';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PatternCandidate {
  name: string;
  description: string;
  triggers?: string[];
  body: string;
  score?: number;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Convert a mined pattern into an FcSkill with proper frontmatter.
 * Source defaults to 'pyrfor-pattern-miner'.
 */
export function patternToSkill(
  pattern: PatternCandidate,
  opts?: { source?: string; now?: () => Date },
): FcSkill {
  const source = opts?.source ?? 'pyrfor-pattern-miner';
  const createdAt = (opts?.now ?? (() => new Date()))().toISOString();

  return {
    fm: {
      name: pattern.name,
      description: pattern.description,
      triggers: pattern.triggers,
      source,
      createdAt,
    },
    body: pattern.body,
  };
}

/**
 * Bulk: convert candidates with score >= threshold into skills, write via writer, return paths.
 */
export async function emitSkills(
  candidates: PatternCandidate[],
  writer: SkillWriter,
  opts?: { minScore?: number; source?: string },
): Promise<string[]> {
  const minScore = opts?.minScore ?? 0;
  const paths: string[] = [];

  for (const candidate of candidates) {
    if ((candidate.score ?? 0) < minScore) continue;
    const skill = patternToSkill(candidate, { source: opts?.source });
    const filePath = await writer.write(skill);
    paths.push(filePath);
  }

  return paths;
}

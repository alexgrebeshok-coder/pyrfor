import { createHash } from 'node:crypto';
import { defaultSkillsLibrary, type Skill, type SkillsLibrary } from './skills-library';

const DEFAULT_RECOMMEND_LIMIT = 5;
const MAX_RECOMMEND_LIMIT = 10;
const MAX_TASK_CHARS = 2_000;

export interface PublicSkillSummary {
  id: string;
  name: string;
  description: string;
  whenToUse: string[];
  tags: string[];
  stepsCount: number;
  examplesCount: number;
  estimatedTokens: number;
  systemPromptHash: string;
}

export interface SkillCatalogResponse {
  total: number;
  skills: PublicSkillSummary[];
}

export interface SkillRecommendInput {
  task: string;
  limit?: number;
}

export interface SkillRecommendResponse {
  taskPreview: string;
  limit: number;
  recommendations: PublicSkillSummary[];
}

export function publicSkillSummary(skill: Skill): PublicSkillSummary {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    whenToUse: [...skill.whenToUse],
    tags: [...skill.tags],
    stepsCount: skill.steps.length,
    examplesCount: skill.examples.length,
    estimatedTokens: skill.estimatedTokens ?? Math.ceil(skill.systemPrompt.length / 4),
    systemPromptHash: createHash('sha256').update(skill.systemPrompt).digest('hex'),
  };
}

export function listSkillCatalog(library: SkillsLibrary = defaultSkillsLibrary): SkillCatalogResponse {
  const skills = library.list()
    .map(publicSkillSummary)
    .sort((left, right) => left.id.localeCompare(right.id));
  return { total: skills.length, skills };
}

export function normalizeSkillRecommendInput(input: unknown): { task: string; limit: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('invalid_skill_recommend_request');
  }
  const record = input as Record<string, unknown>;
  const task = typeof record.task === 'string' ? record.task.trim() : '';
  if (!task) {
    throw new Error('invalid_skill_task');
  }
  if (task.length > MAX_TASK_CHARS) {
    throw new Error('skill_task_too_long');
  }
  const rawLimit = typeof record.limit === 'number' && Number.isFinite(record.limit)
    ? Math.trunc(record.limit)
    : DEFAULT_RECOMMEND_LIMIT;
  const limit = Math.min(MAX_RECOMMEND_LIMIT, Math.max(1, rawLimit));
  return { task, limit };
}

export function recommendSkillsPreview(
  input: unknown,
  library: SkillsLibrary = defaultSkillsLibrary,
): SkillRecommendResponse {
  const { task, limit } = normalizeSkillRecommendInput(input);
  return {
    taskPreview: task.length <= 160 ? task : `${task.slice(0, 159)}…`,
    limit,
    recommendations: library.findRelevant(task, limit).map(publicSkillSummary),
  };
}

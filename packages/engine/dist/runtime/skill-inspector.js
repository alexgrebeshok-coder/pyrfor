import { createHash } from 'node:crypto';
import { defaultSkillsLibrary } from './skills-library.js';
const DEFAULT_RECOMMEND_LIMIT = 5;
const MAX_RECOMMEND_LIMIT = 10;
const MAX_TASK_CHARS = 2000;
export function publicSkillSummary(skill) {
    var _a;
    return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        whenToUse: [...skill.whenToUse],
        tags: [...skill.tags],
        stepsCount: skill.steps.length,
        examplesCount: skill.examples.length,
        estimatedTokens: (_a = skill.estimatedTokens) !== null && _a !== void 0 ? _a : Math.ceil(skill.systemPrompt.length / 4),
        systemPromptHash: createHash('sha256').update(skill.systemPrompt).digest('hex'),
    };
}
export function listSkillCatalog(library = defaultSkillsLibrary) {
    const skills = library.list()
        .map(publicSkillSummary)
        .sort((left, right) => left.id.localeCompare(right.id));
    return { total: skills.length, skills };
}
export function normalizeSkillRecommendInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('invalid_skill_recommend_request');
    }
    const record = input;
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
export function recommendSkillsPreview(input, library = defaultSkillsLibrary) {
    const { task, limit } = normalizeSkillRecommendInput(input);
    return {
        taskPreview: task.length <= 160 ? task : `${task.slice(0, 159)}…`,
        limit,
        recommendations: library.findRelevant(task, limit).map(publicSkillSummary),
    };
}

/**
 * reflection — Pyrfor self-reflection module.
 *
 * After long pipelines, a secondary LLM call extracts lessons that are
 * persisted to ~/.pyrfor/lessons.jsonl and injected into future system prompts.
 */

import { promises as fsp } from 'fs';
import path from 'path';
import { homedir, tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { logger } from '../observability/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PipelineSummary {
  sessionId: string;
  userInput: string;
  toolCalls: Array<{ name: string; success: boolean; latencyMs: number; errorMessage?: string }>;
  finalAnswer: string;
  success: boolean;
  iterations: number;
  durationMs: number;
}

export interface Lesson {
  id: string;
  sessionId: string;
  category: 'success-pattern' | 'failure-mode' | 'user-preference' | 'tool-tip' | 'general';
  insight: string;
  context: string;
  weight: number;
  embedding?: number[];
  createdAt: string;
  appliedCount: number;
}

export interface ReflectionLLM {
  chat(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    opts?: { model?: string; temperature?: number },
  ): Promise<string>;
}

export interface ReflectionOptions {
  baseDir?: string;
  enabled?: boolean;
  minIterations?: number;
  llm: ReflectionLLM;
  llmModel?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set([
  'success-pattern',
  'failure-mode',
  'user-preference',
  'tool-tip',
  'general',
]);

const REFLECTION_SYSTEM_PROMPT = `Ты — внутренний рефлексивный модуль AI-агента Pyrfor. Твоя задача: проанализировать только что завершённый pipeline и извлечь МАКСИМУМ 3 КРАТКИХ урока, которые помогут агенту в будущем.

Категории:
- success-pattern: что сработало хорошо и должно повторяться
- failure-mode: что пошло не так и как этого избежать
- user-preference: что пользователь предпочитает (стиль, формат, подход)
- tool-tip: подсказка по работе с конкретным инструментом
- general: общий урок, не вписывающийся в выше

Отвечай СТРОГО валидным JSON-массивом без обёртки markdown:
[{"category": "...", "insight": "...", "context": "...", "weight": 0.8}, ...]

Если уроков нет (всё стандартно) — возвращай пустой массив [].`;

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + randomBytes(10).toString('hex');
}

function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

interface RawLesson {
  category: unknown;
  insight: unknown;
  context: unknown;
  weight: unknown;
}

function validateRawLesson(raw: unknown): raw is RawLesson {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (!VALID_CATEGORIES.has(r['category'] as string)) return false;
  if (typeof r['insight'] !== 'string' || r['insight'].trim() === '') return false;
  if (typeof r['weight'] !== 'number' || r['weight'] < 0 || r['weight'] > 1) return false;
  return true;
}

// Simple per-instance async mutex
class Mutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true;
          resolve(() => {
            this._locked = false;
            const next = this._queue.shift();
            if (next) next();
          });
        } else {
          this._queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
}

// ── Reflector ─────────────────────────────────────────────────────────────

export class Reflector {
  private readonly baseDir: string;
  private readonly enabled: boolean;
  private readonly minIterations: number;
  private readonly llm: ReflectionLLM;
  private readonly llmModel: string;
  private readonly lessonsFile: string;
  private readonly _mutex = new Mutex();

  constructor(opts: ReflectionOptions) {
    this.baseDir = opts.baseDir ?? path.join(homedir(), '.pyrfor');
    this.enabled = opts.enabled ?? true;
    this.minIterations = opts.minIterations ?? 5;
    this.llm = opts.llm;
    this.llmModel = opts.llmModel ?? 'glm-4.5-flash';
    this.lessonsFile = path.join(this.baseDir, 'lessons.jsonl');
  }

  async reflect(summary: PipelineSummary): Promise<Lesson[]> {
    if (!this.enabled) return [];
    if (summary.iterations < this.minIterations) return [];

    const userMessage = JSON.stringify(summary, null, 2);

    let raw: string;
    try {
      raw = await this.llm.chat(
        [
          { role: 'system', content: REFLECTION_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        { model: this.llmModel, temperature: 0.3 },
      );
    } catch (err) {
      logger.warn('[Reflector] LLM call failed', { err });
      return [];
    }

    const stripped = stripMarkdownFences(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      logger.warn('[Reflector] Failed to parse LLM response as JSON', { raw });
      return [];
    }

    if (!Array.isArray(parsed)) {
      logger.warn('[Reflector] LLM response is not an array', { parsed });
      return [];
    }

    const now = new Date().toISOString();
    const lessons: Lesson[] = [];

    for (const entry of parsed) {
      if (!validateRawLesson(entry)) {
        logger.warn('[Reflector] Dropping invalid lesson entry', { entry });
        continue;
      }
      lessons.push({
        id: generateId(),
        sessionId: summary.sessionId,
        category: entry.category as Lesson['category'],
        insight: (entry.insight as string).trim(),
        context: typeof entry.context === 'string' ? (entry.context as string).trim() : '',
        weight: entry.weight as number,
        createdAt: now,
        appliedCount: 0,
      });
    }

    return lessons;
  }

  async persist(lessons: Lesson[]): Promise<void> {
    if (lessons.length === 0) return;

    const release = await this._mutex.acquire();
    try {
      await fsp.mkdir(this.baseDir, { recursive: true });
      const lines = lessons.map((l) => JSON.stringify(l)).join('\n') + '\n';
      await fsp.appendFile(this.lessonsFile, lines, 'utf-8');
    } finally {
      release();
    }
  }

  async loadAll(): Promise<Lesson[]> {
    let content: string;
    try {
      content = await fsp.readFile(this.lessonsFile, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const lessons: Lesson[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        lessons.push(JSON.parse(trimmed) as Lesson);
      } catch {
        logger.warn('[Reflector] Skipping malformed lessons.jsonl line', { line: trimmed });
      }
    }
    return lessons;
  }

  async markApplied(id: string): Promise<void> {
    const release = await this._mutex.acquire();
    try {
      const all = await this.loadAll();
      const idx = all.findIndex((l) => l.id === id);
      if (idx === -1) return;
      all[idx] = { ...all[idx], appliedCount: all[idx].appliedCount + 1 };

      await fsp.mkdir(this.baseDir, { recursive: true });
      const tmpFile = path.join(tmpdir(), `lessons-${Date.now()}-${randomBytes(4).toString('hex')}.jsonl`);
      const data = all.map((l) => JSON.stringify(l)).join('\n') + '\n';
      await fsp.writeFile(tmpFile, data, 'utf-8');
      await fsp.rename(tmpFile, this.lessonsFile);
    } finally {
      release();
    }
  }
}

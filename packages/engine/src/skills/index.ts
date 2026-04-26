/**
 * Skills System - AI-powered capabilities
 * 
 * Built-in skills for CEOClaw:
 * - Weather
 * - Research
 * - Evaluation
 * - Summary
 * - Translation
 */

// ============================================
// Types
// ============================================

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "productivity" | "analysis" | "communication" | "automation";
  keywords: string[];
  execute: (input: SkillInput) => Promise<SkillOutput>;
  validate?: (input: SkillInput) => boolean;
}

export interface SkillInput {
  query: string;
  context?: Record<string, unknown>;
  userId?: string;
  projectId?: string;
}

export interface SkillOutput {
  success: boolean;
  result: string;
  data?: Record<string, unknown>;
  sources?: string[];
  error?: string;
}

// ============================================
// Weather Skill
// ============================================

export const weatherSkill: Skill = {
  id: "weather",
  name: "Погода",
  description: "Получить прогноз погоды для любого города",
  icon: "🌤️",
  category: "productivity",
  keywords: ["погода", "weather", "температура", "forecast", "дождь", "снег"],

  async execute(input: SkillInput): Promise<SkillOutput> {
    const cityMatch = input.query.match(/(?:погода|weather)\s+(?:в\s+)?([а-яёa-z\s]+)/i);
    const city = cityMatch ? cityMatch[1].trim() : "Сургут";

    try {
      // Use Open-Meteo (free, no API key)
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`
      );
      const geoData = await geoRes.json();

      if (!geoData.results?.[0]) {
        return {
          success: false,
          result: `Город "${city}" не найден`,
          error: "CITY_NOT_FOUND",
        };
      }

      const { latitude, longitude, name: cityName } = geoData.results[0];

      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m&timezone=auto&forecast_days=1`
      );
      const weatherData = await weatherRes.json();

      const current = weatherData.current;
      const temp = Math.round(current.temperature_2m);
      const windSpeed = Math.round(current.wind_speed_10m);
      const weatherCode = current.weather_code;

      // Weather code descriptions (simplified)
      const weatherDescriptions: Record<number, string> = {
        0: "Ясно ☀️",
        1: "Малооблачно 🌤️",
        2: "Переменная облачность ⛅",
        3: "Облачно ☁️",
        45: "Туман 🌫️",
        48: "Изморозь 🌫️",
        51: "Морось 🌧️",
        61: "Дождь 🌧️",
        63: "Сильный дождь 🌧️",
        71: "Снег 🌨️",
        95: "Гроза ⛈️",
      };

      const description = weatherDescriptions[weatherCode] || "Неизвестно";

      const result = `**${cityName}**: ${temp}°C, ${description}, ветер ${windSpeed} км/ч`;

      return {
        success: true,
        result,
        data: {
          city: cityName,
          temperature: temp,
          weatherCode,
          windSpeed,
          description,
        },
        sources: ["Open-Meteo"],
      };
    } catch (error) {
      return {
        success: false,
        result: "Ошибка получения погоды",
        error: error instanceof Error ? error.message : "UNKNOWN",
      };
    }
  },

  validate(input: SkillInput): boolean {
    return this.keywords.some((k) => input.query.toLowerCase().includes(k));
  },
};

// ============================================
// Research Skill
// ============================================

export const researchSkill: Skill = {
  id: "research",
  name: "Исследование",
  description: "Поиск информации в интернете",
  icon: "🔍",
  category: "analysis",
  keywords: ["найди", "поиск", "research", "find", "search", "что такое"],

  async execute(input: SkillInput): Promise<SkillOutput> {
    // Extract query
    const query = input.query
      .replace(/^(найди|поиск|research|find|search|что такое)\s+/i, "")
      .trim();

    if (!query) {
      return {
        success: false,
        result: "Укажите что искать",
        error: "EMPTY_QUERY",
      };
    }

    try {
      // Use DuckDuckGo Instant Answer API (free, no API key)
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      );
      const data = await res.json();

      if (data.AbstractText) {
        return {
          success: true,
          result: data.AbstractText,
          data: {
            title: data.Heading,
            url: data.AbstractURL,
            image: data.Image,
          },
          sources: [data.AbstractURL || "DuckDuckGo"],
        };
      }

      // Fallback to related topics
      if (data.RelatedTopics?.length > 0) {
        const topics = data.RelatedTopics.slice(0, 3)
          .map((t: { Text?: string }) => t.Text)
          .filter(Boolean)
          .join("\n\n");

        return {
          success: true,
          result: topics || "Информация не найдена",
          sources: ["DuckDuckGo"],
        };
      }

      return {
        success: false,
        result: `По запросу "${query}" ничего не найдено`,
        error: "NO_RESULTS",
      };
    } catch (error) {
      return {
        success: false,
        result: "Ошибка поиска",
        error: error instanceof Error ? error.message : "UNKNOWN",
      };
    }
  },

  validate(input: SkillInput): boolean {
    return this.keywords.some((k) => input.query.toLowerCase().includes(k));
  },
};

// ============================================
// Summary Skill
// ============================================

export const summarySkill: Skill = {
  id: "summary",
  name: "Саммари",
  description: "Краткое изложение текста",
  icon: "📝",
  category: "productivity",
  keywords: ["саммари", "summary", "кратко", "суть", "выдели главное"],

  async execute(_input: SkillInput): Promise<SkillOutput> {
    // This skill requires AI provider
    // For now, return placeholder
    return {
      success: true,
      result: "Для саммари требуется AI провайдер. Настройте API ключ в /settings/ai",
      data: {
        requiresAI: true,
      },
    };
  },

  validate(input: SkillInput): boolean {
    return this.keywords.some((k) => input.query.toLowerCase().includes(k));
  },
};

// ============================================
// Translation Skill
// ============================================

export const translationSkill: Skill = {
  id: "translation",
  name: "Перевод",
  description: "Перевод текста на разные языки",
  icon: "🌐",
  category: "communication",
  keywords: ["переведи", "translate", "на английский", "на русский"],

  async execute(_input: SkillInput): Promise<SkillOutput> {
    // This skill requires AI provider
    return {
      success: true,
      result: "Для перевода требуется AI провайдер. Настройте API ключ в /settings/ai",
      data: {
        requiresAI: true,
      },
    };
  },

  validate(input: SkillInput): boolean {
    return this.keywords.some((k) => input.query.toLowerCase().includes(k));
  },
};

// ============================================
// Evaluation Skill
// ============================================

export const evaluationSkill: Skill = {
  id: "evaluation",
  name: "Оценка",
  description: "LLM-as-a-Judge оценка качества",
  icon: "⚖️",
  category: "analysis",
  keywords: ["оцени", "evaluate", "judge", "сравни"],

  async execute(_input: SkillInput): Promise<SkillOutput> {
    // This skill requires AI provider
    return {
      success: true,
      result: "Для оценки требуется AI провайдер. Настройте API ключ в /settings/ai",
      data: {
        requiresAI: true,
      },
    };
  },

  validate(input: SkillInput): boolean {
    return this.keywords.some((k) => input.query.toLowerCase().includes(k));
  },
};

// ============================================
// Skills Registry
// ============================================

export const skillsRegistry: Skill[] = [
  weatherSkill,
  researchSkill,
  summarySkill,
  translationSkill,
  evaluationSkill,
];

/**
 * Find matching skill for a query
 */
export function findSkill(query: string): Skill | null {
  const lowerQuery = query.toLowerCase();

  for (const skill of skillsRegistry) {
    if (skill.validate?.({ query: lowerQuery })) {
      return skill;
    }
  }

  return null;
}

/**
 * Execute skill by ID
 */
export async function executeSkill(
  skillId: string,
  input: SkillInput
): Promise<SkillOutput> {
  const skill = skillsRegistry.find((s) => s.id === skillId);

  if (!skill) {
    return {
      success: false,
      result: `Skill "${skillId}" not found`,
      error: "SKILL_NOT_FOUND",
    };
  }

  return skill.execute(input);
}

/**
 * Get all available skills
 */
export function getAvailableSkills(): Skill[] {
  return skillsRegistry;
}

/**
 * Get skills by category
 */
export function getSkillsByCategory(
  category: Skill["category"]
): Skill[] {
  return skillsRegistry.filter((s) => s.category === category);
}

// ============================================
// Dynamic Skill Registration (from SKILL.md)
// ============================================

import { parseSkillMd } from './skill-md-parser';
import type { Message } from '../ai/providers/base';

/** Optional AI chat function injected by the runtime so dynamic skills can call the provider. */
type AIChatFn = (messages: Message[]) => Promise<string>;
let _aiChat: AIChatFn | null = null;

/** Inject an AI provider chat function for use by dynamic skills. Called by the runtime after start(). */
export function setSkillAIProvider(fn: AIChatFn): void {
  _aiChat = fn;
}

const VALID_CATEGORIES = new Set<Skill['category']>(['productivity', 'analysis', 'communication', 'automation']);

function toCategory(raw: string | undefined): Skill['category'] {
  if (raw && VALID_CATEGORIES.has(raw as Skill['category'])) {
    return raw as Skill['category'];
  }
  return 'automation';
}

/**
 * Parse raw SKILL.md strings and register each as a Skill in skillsRegistry.
 *
 * - Skills are prefixed with `user:` to avoid collisions with built-ins.
 * - If a skill with the same id already exists (e.g. from a previous load), it is replaced.
 * - Returns the number of skills successfully registered.
 */
export function registerDynamicSkills(rawSkillFiles: string[]): number {
  let registered = 0;

  for (const raw of rawSkillFiles) {
    const parsed = parseSkillMd(raw);
    if (!parsed) continue;

    const id = `user:${parsed.name.toLowerCase().replace(/\s+/g, '-')}`;

    // Build keywords from trigger (space/comma separated) or fall back to name tokens
    const triggerStr = parsed.trigger ?? parsed.name;
    const keywords = triggerStr
      .split(/[\s,]+/)
      .map((k) => k.toLowerCase().trim())
      .filter(Boolean);

    const prompt = parsed.prompt;
    const skillName = parsed.name;

    const skill: Skill = {
      id,
      name: skillName,
      description: parsed.description || skillName,
      icon: parsed.icon || '🔧',
      category: toCategory(parsed.category),
      keywords,

      async execute(input: SkillInput): Promise<SkillOutput> {
        if (!_aiChat) {
          return {
            success: true,
            result: `Skill "${skillName}" requires an AI provider. Configure one in /settings/ai.\n\nPrompt:\n${prompt}`,
            data: { requiresAI: true, prompt },
          };
        }

        try {
          const messages: Message[] = [
            { role: 'system', content: prompt },
            { role: 'user', content: input.query },
          ];
          const result = await _aiChat(messages);
          return { success: true, result };
        } catch (err) {
          return {
            success: false,
            result: `Skill "${skillName}" failed`,
            error: err instanceof Error ? err.message : 'UNKNOWN',
          };
        }
      },

      validate(input: SkillInput): boolean {
        const lq = input.query.toLowerCase();
        return keywords.some((k) => lq.includes(k));
      },
    };

    // Replace existing dynamic skill with same id, otherwise append
    const existingIdx = skillsRegistry.findIndex((s) => s.id === id);
    if (existingIdx >= 0) {
      skillsRegistry[existingIdx] = skill;
    } else {
      skillsRegistry.push(skill);
    }

    registered++;
  }

  return registered;
}

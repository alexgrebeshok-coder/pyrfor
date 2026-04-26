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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ============================================
// Weather Skill
// ============================================
export const weatherSkill = {
    id: "weather",
    name: "Погода",
    description: "Получить прогноз погоды для любого города",
    icon: "🌤️",
    category: "productivity",
    keywords: ["погода", "weather", "температура", "forecast", "дождь", "снег"],
    execute(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const cityMatch = input.query.match(/(?:погода|weather)\s+(?:в\s+)?([а-яёa-z\s]+)/i);
            const city = cityMatch ? cityMatch[1].trim() : "Сургут";
            try {
                // Use Open-Meteo (free, no API key)
                const geoRes = yield fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`);
                const geoData = yield geoRes.json();
                if (!((_a = geoData.results) === null || _a === void 0 ? void 0 : _a[0])) {
                    return {
                        success: false,
                        result: `Город "${city}" не найден`,
                        error: "CITY_NOT_FOUND",
                    };
                }
                const { latitude, longitude, name: cityName } = geoData.results[0];
                const weatherRes = yield fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m&timezone=auto&forecast_days=1`);
                const weatherData = yield weatherRes.json();
                const current = weatherData.current;
                const temp = Math.round(current.temperature_2m);
                const windSpeed = Math.round(current.wind_speed_10m);
                const weatherCode = current.weather_code;
                // Weather code descriptions (simplified)
                const weatherDescriptions = {
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
            }
            catch (error) {
                return {
                    success: false,
                    result: "Ошибка получения погоды",
                    error: error instanceof Error ? error.message : "UNKNOWN",
                };
            }
        });
    },
    validate(input) {
        return this.keywords.some((k) => input.query.toLowerCase().includes(k));
    },
};
// ============================================
// Research Skill
// ============================================
export const researchSkill = {
    id: "research",
    name: "Исследование",
    description: "Поиск информации в интернете",
    icon: "🔍",
    category: "analysis",
    keywords: ["найди", "поиск", "research", "find", "search", "что такое"],
    execute(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
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
                const res = yield fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
                const data = yield res.json();
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
                if (((_a = data.RelatedTopics) === null || _a === void 0 ? void 0 : _a.length) > 0) {
                    const topics = data.RelatedTopics.slice(0, 3)
                        .map((t) => t.Text)
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
            }
            catch (error) {
                return {
                    success: false,
                    result: "Ошибка поиска",
                    error: error instanceof Error ? error.message : "UNKNOWN",
                };
            }
        });
    },
    validate(input) {
        return this.keywords.some((k) => input.query.toLowerCase().includes(k));
    },
};
// ============================================
// Summary Skill
// ============================================
export const summarySkill = {
    id: "summary",
    name: "Саммари",
    description: "Краткое изложение текста",
    icon: "📝",
    category: "productivity",
    keywords: ["саммари", "summary", "кратко", "суть", "выдели главное"],
    execute(_input) {
        return __awaiter(this, void 0, void 0, function* () {
            // This skill requires AI provider
            // For now, return placeholder
            return {
                success: true,
                result: "Для саммари требуется AI провайдер. Настройте API ключ в /settings/ai",
                data: {
                    requiresAI: true,
                },
            };
        });
    },
    validate(input) {
        return this.keywords.some((k) => input.query.toLowerCase().includes(k));
    },
};
// ============================================
// Translation Skill
// ============================================
export const translationSkill = {
    id: "translation",
    name: "Перевод",
    description: "Перевод текста на разные языки",
    icon: "🌐",
    category: "communication",
    keywords: ["переведи", "translate", "на английский", "на русский"],
    execute(_input) {
        return __awaiter(this, void 0, void 0, function* () {
            // This skill requires AI provider
            return {
                success: true,
                result: "Для перевода требуется AI провайдер. Настройте API ключ в /settings/ai",
                data: {
                    requiresAI: true,
                },
            };
        });
    },
    validate(input) {
        return this.keywords.some((k) => input.query.toLowerCase().includes(k));
    },
};
// ============================================
// Evaluation Skill
// ============================================
export const evaluationSkill = {
    id: "evaluation",
    name: "Оценка",
    description: "LLM-as-a-Judge оценка качества",
    icon: "⚖️",
    category: "analysis",
    keywords: ["оцени", "evaluate", "judge", "сравни"],
    execute(_input) {
        return __awaiter(this, void 0, void 0, function* () {
            // This skill requires AI provider
            return {
                success: true,
                result: "Для оценки требуется AI провайдер. Настройте API ключ в /settings/ai",
                data: {
                    requiresAI: true,
                },
            };
        });
    },
    validate(input) {
        return this.keywords.some((k) => input.query.toLowerCase().includes(k));
    },
};
// ============================================
// Skills Registry
// ============================================
export const skillsRegistry = [
    weatherSkill,
    researchSkill,
    summarySkill,
    translationSkill,
    evaluationSkill,
];
/**
 * Find matching skill for a query
 */
export function findSkill(query) {
    var _a;
    const lowerQuery = query.toLowerCase();
    for (const skill of skillsRegistry) {
        if ((_a = skill.validate) === null || _a === void 0 ? void 0 : _a.call(skill, { query: lowerQuery })) {
            return skill;
        }
    }
    return null;
}
/**
 * Execute skill by ID
 */
export function executeSkill(skillId, input) {
    return __awaiter(this, void 0, void 0, function* () {
        const skill = skillsRegistry.find((s) => s.id === skillId);
        if (!skill) {
            return {
                success: false,
                result: `Skill "${skillId}" not found`,
                error: "SKILL_NOT_FOUND",
            };
        }
        return skill.execute(input);
    });
}
/**
 * Get all available skills
 */
export function getAvailableSkills() {
    return skillsRegistry;
}
/**
 * Get skills by category
 */
export function getSkillsByCategory(category) {
    return skillsRegistry.filter((s) => s.category === category);
}
// ============================================
// Dynamic Skill Registration (from SKILL.md)
// ============================================
import { parseSkillMd } from './skill-md-parser.js';
let _aiChat = null;
/** Inject an AI provider chat function for use by dynamic skills. Called by the runtime after start(). */
export function setSkillAIProvider(fn) {
    _aiChat = fn;
}
const VALID_CATEGORIES = new Set(['productivity', 'analysis', 'communication', 'automation']);
function toCategory(raw) {
    if (raw && VALID_CATEGORIES.has(raw)) {
        return raw;
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
export function registerDynamicSkills(rawSkillFiles) {
    var _a;
    let registered = 0;
    for (const raw of rawSkillFiles) {
        const parsed = parseSkillMd(raw);
        if (!parsed)
            continue;
        const id = `user:${parsed.name.toLowerCase().replace(/\s+/g, '-')}`;
        // Build keywords from trigger (space/comma separated) or fall back to name tokens
        const triggerStr = (_a = parsed.trigger) !== null && _a !== void 0 ? _a : parsed.name;
        const keywords = triggerStr
            .split(/[\s,]+/)
            .map((k) => k.toLowerCase().trim())
            .filter(Boolean);
        const prompt = parsed.prompt;
        const skillName = parsed.name;
        const skill = {
            id,
            name: skillName,
            description: parsed.description || skillName,
            icon: parsed.icon || '🔧',
            category: toCategory(parsed.category),
            keywords,
            execute(input) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (!_aiChat) {
                        return {
                            success: true,
                            result: `Skill "${skillName}" requires an AI provider. Configure one in /settings/ai.\n\nPrompt:\n${prompt}`,
                            data: { requiresAI: true, prompt },
                        };
                    }
                    try {
                        const messages = [
                            { role: 'system', content: prompt },
                            { role: 'user', content: input.query },
                        ];
                        const result = yield _aiChat(messages);
                        return { success: true, result };
                    }
                    catch (err) {
                        return {
                            success: false,
                            result: `Skill "${skillName}" failed`,
                            error: err instanceof Error ? err.message : 'UNKNOWN',
                        };
                    }
                });
            },
            validate(input) {
                const lq = input.query.toLowerCase();
                return keywords.some((k) => lq.includes(k));
            },
        };
        // Replace existing dynamic skill with same id, otherwise append
        const existingIdx = skillsRegistry.findIndex((s) => s.id === id);
        if (existingIdx >= 0) {
            skillsRegistry[existingIdx] = skill;
        }
        else {
            skillsRegistry.push(skill);
        }
        registered++;
    }
    return registered;
}

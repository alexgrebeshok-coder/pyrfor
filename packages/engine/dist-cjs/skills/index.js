"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.skillsRegistry = exports.evaluationSkill = exports.translationSkill = exports.summarySkill = exports.researchSkill = exports.weatherSkill = void 0;
exports.findSkill = findSkill;
exports.executeSkill = executeSkill;
exports.getAvailableSkills = getAvailableSkills;
exports.getSkillsByCategory = getSkillsByCategory;
// ============================================
// Weather Skill
// ============================================
exports.weatherSkill = {
    id: "weather",
    name: "Погода",
    description: "Получить прогноз погоды для любого города",
    icon: "🌤️",
    category: "productivity",
    keywords: ["погода", "weather", "температура", "forecast", "дождь", "снег"],
    async execute(input) {
        const cityMatch = input.query.match(/(?:погода|weather)\s+(?:в\s+)?([а-яёa-z\s]+)/i);
        const city = cityMatch ? cityMatch[1].trim() : "Сургут";
        try {
            // Use Open-Meteo (free, no API key)
            const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`);
            const geoData = await geoRes.json();
            if (!geoData.results?.[0]) {
                return {
                    success: false,
                    result: `Город "${city}" не найден`,
                    error: "CITY_NOT_FOUND",
                };
            }
            const { latitude, longitude, name: cityName } = geoData.results[0];
            const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m&timezone=auto&forecast_days=1`);
            const weatherData = await weatherRes.json();
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
    },
    validate(input) {
        return this.keywords.some((k) => input.query.toLowerCase().includes(k));
    },
};
// ============================================
// Research Skill
// ============================================
exports.researchSkill = {
    id: "research",
    name: "Исследование",
    description: "Поиск информации в интернете",
    icon: "🔍",
    category: "analysis",
    keywords: ["найди", "поиск", "research", "find", "search", "что такое"],
    async execute(input) {
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
            const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
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
    },
    validate(input) {
        return this.keywords.some((k) => input.query.toLowerCase().includes(k));
    },
};
// ============================================
// Summary Skill
// ============================================
exports.summarySkill = {
    id: "summary",
    name: "Саммари",
    description: "Краткое изложение текста",
    icon: "📝",
    category: "productivity",
    keywords: ["саммари", "summary", "кратко", "суть", "выдели главное"],
    async execute(_input) {
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
    validate(input) {
        return this.keywords.some((k) => input.query.toLowerCase().includes(k));
    },
};
// ============================================
// Translation Skill
// ============================================
exports.translationSkill = {
    id: "translation",
    name: "Перевод",
    description: "Перевод текста на разные языки",
    icon: "🌐",
    category: "communication",
    keywords: ["переведи", "translate", "на английский", "на русский"],
    async execute(_input) {
        // This skill requires AI provider
        return {
            success: true,
            result: "Для перевода требуется AI провайдер. Настройте API ключ в /settings/ai",
            data: {
                requiresAI: true,
            },
        };
    },
    validate(input) {
        return this.keywords.some((k) => input.query.toLowerCase().includes(k));
    },
};
// ============================================
// Evaluation Skill
// ============================================
exports.evaluationSkill = {
    id: "evaluation",
    name: "Оценка",
    description: "LLM-as-a-Judge оценка качества",
    icon: "⚖️",
    category: "analysis",
    keywords: ["оцени", "evaluate", "judge", "сравни"],
    async execute(_input) {
        // This skill requires AI provider
        return {
            success: true,
            result: "Для оценки требуется AI провайдер. Настройте API ключ в /settings/ai",
            data: {
                requiresAI: true,
            },
        };
    },
    validate(input) {
        return this.keywords.some((k) => input.query.toLowerCase().includes(k));
    },
};
// ============================================
// Skills Registry
// ============================================
exports.skillsRegistry = [
    exports.weatherSkill,
    exports.researchSkill,
    exports.summarySkill,
    exports.translationSkill,
    exports.evaluationSkill,
];
/**
 * Find matching skill for a query
 */
function findSkill(query) {
    const lowerQuery = query.toLowerCase();
    for (const skill of exports.skillsRegistry) {
        if (skill.validate?.({ query: lowerQuery })) {
            return skill;
        }
    }
    return null;
}
/**
 * Execute skill by ID
 */
async function executeSkill(skillId, input) {
    const skill = exports.skillsRegistry.find((s) => s.id === skillId);
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
function getAvailableSkills() {
    return exports.skillsRegistry;
}
/**
 * Get skills by category
 */
function getSkillsByCategory(category) {
    return exports.skillsRegistry.filter((s) => s.category === category);
}

export const DEFAULT_BRIEF_LOCALE = "ru";
const STATUS_LABELS = {
    ru: {
        active: "активный",
        planning: "планирование",
        completed: "завершён",
        "at-risk": "под риском",
        "on-hold": "приостановлен",
    },
    en: {
        active: "active",
        planning: "planning",
        completed: "completed",
        "at-risk": "at-risk",
        "on-hold": "on-hold",
    },
};
export function resolveBriefLocale(value) {
    return value === "en" ? "en" : DEFAULT_BRIEF_LOCALE;
}
export function formatShortDate(value, locale = DEFAULT_BRIEF_LOCALE) {
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
        day: "numeric",
        month: "short",
    }).format(new Date(value));
}
export function formatCurrency(value, currency = "RUB", locale = DEFAULT_BRIEF_LOCALE) {
    return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
        maximumFractionDigits: 0,
        style: "currency",
        currency,
    }).format(value);
}
export function formatSignedPercent(value, locale = DEFAULT_BRIEF_LOCALE) {
    const percent = round(value * 100, 1);
    const formatted = new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
        maximumFractionDigits: 1,
        minimumFractionDigits: Number.isInteger(percent) ? 0 : 1,
    }).format(percent);
    return `${percent >= 0 ? "+" : ""}${formatted}%`;
}
export function formatList(values, locale = DEFAULT_BRIEF_LOCALE) {
    if (!values.length) {
        return locale === "ru" ? "без явного лидера" : "no single project";
    }
    if (values.length === 1) {
        return values[0];
    }
    return locale === "ru"
        ? `${values.slice(0, -1).join(", ")} и ${values.at(-1)}`
        : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}
export function formatProjectStatus(status, locale = DEFAULT_BRIEF_LOCALE) {
    var _a;
    return (_a = STATUS_LABELS[locale][status]) !== null && _a !== void 0 ? _a : status;
}
export function formatTaskNoun(count, locale = DEFAULT_BRIEF_LOCALE, adjective) {
    if (locale === "ru") {
        if (adjective === "overdue") {
            return pluralizeRu(count, [
                "просроченная задача",
                "просроченные задачи",
                "просроченных задач",
            ]);
        }
        if (adjective === "blocked") {
            return pluralizeRu(count, [
                "заблокированная задача",
                "заблокированные задачи",
                "заблокированных задач",
            ]);
        }
        if (adjective === "open") {
            return pluralizeRu(count, [
                "открытая задача",
                "открытые задачи",
                "открытых задач",
            ]);
        }
        return pluralizeRu(count, ["задача", "задачи", "задач"]);
    }
    if (adjective === "overdue") {
        return count === 1 ? "overdue task" : "overdue tasks";
    }
    if (adjective === "blocked") {
        return count === 1 ? "blocked task" : "blocked tasks";
    }
    if (adjective === "open") {
        return count === 1 ? "open task" : "open tasks";
    }
    return count === 1 ? "task" : "tasks";
}
export function formatRiskNoun(count, locale = DEFAULT_BRIEF_LOCALE, adjective) {
    if (locale === "ru") {
        if (adjective === "open") {
            return pluralizeRu(count, [
                "открытый риск",
                "открытые риски",
                "открытых рисков",
            ]);
        }
        return pluralizeRu(count, ["риск", "риска", "рисков"]);
    }
    if (adjective === "open") {
        return count === 1 ? "open risk" : "open risks";
    }
    return count === 1 ? "risk" : "risks";
}
export function formatProjectNoun(count, locale = DEFAULT_BRIEF_LOCALE) {
    if (locale === "ru") {
        return pluralizeRu(count, ["проект", "проекта", "проектов"]);
    }
    return count === 1 ? "project" : "projects";
}
function pluralizeRu(count, forms) {
    const value = Math.abs(count) % 100;
    const unit = value % 10;
    if (value > 10 && value < 20) {
        return forms[2];
    }
    if (unit > 1 && unit < 5) {
        return forms[1];
    }
    if (unit === 1) {
        return forms[0];
    }
    return forms[2];
}
function round(value, digits) {
    const multiplier = Math.pow(10, digits);
    return Math.round(value * multiplier) / multiplier;
}

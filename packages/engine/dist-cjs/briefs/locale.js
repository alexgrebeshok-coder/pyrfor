"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BRIEF_LOCALE = void 0;
exports.resolveBriefLocale = resolveBriefLocale;
exports.formatShortDate = formatShortDate;
exports.formatCurrency = formatCurrency;
exports.formatSignedPercent = formatSignedPercent;
exports.formatList = formatList;
exports.formatProjectStatus = formatProjectStatus;
exports.formatTaskNoun = formatTaskNoun;
exports.formatRiskNoun = formatRiskNoun;
exports.formatProjectNoun = formatProjectNoun;
exports.DEFAULT_BRIEF_LOCALE = "ru";
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
function resolveBriefLocale(value) {
    return value === "en" ? "en" : exports.DEFAULT_BRIEF_LOCALE;
}
function formatShortDate(value, locale = exports.DEFAULT_BRIEF_LOCALE) {
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
        day: "numeric",
        month: "short",
    }).format(new Date(value));
}
function formatCurrency(value, currency = "RUB", locale = exports.DEFAULT_BRIEF_LOCALE) {
    return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
        maximumFractionDigits: 0,
        style: "currency",
        currency,
    }).format(value);
}
function formatSignedPercent(value, locale = exports.DEFAULT_BRIEF_LOCALE) {
    const percent = round(value * 100, 1);
    const formatted = new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
        maximumFractionDigits: 1,
        minimumFractionDigits: Number.isInteger(percent) ? 0 : 1,
    }).format(percent);
    return `${percent >= 0 ? "+" : ""}${formatted}%`;
}
function formatList(values, locale = exports.DEFAULT_BRIEF_LOCALE) {
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
function formatProjectStatus(status, locale = exports.DEFAULT_BRIEF_LOCALE) {
    return STATUS_LABELS[locale][status] ?? status;
}
function formatTaskNoun(count, locale = exports.DEFAULT_BRIEF_LOCALE, adjective) {
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
function formatRiskNoun(count, locale = exports.DEFAULT_BRIEF_LOCALE, adjective) {
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
function formatProjectNoun(count, locale = exports.DEFAULT_BRIEF_LOCALE) {
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
    const multiplier = 10 ** digits;
    return Math.round(value * multiplier) / multiplier;
}

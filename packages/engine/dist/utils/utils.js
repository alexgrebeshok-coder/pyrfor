"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.riskStatusMeta = exports.severityMeta = exports.directionMeta = exports.priorityMeta = exports.taskStatusMeta = exports.projectStatusMeta = void 0;
exports.cn = cn;
exports.formatCurrency = formatCurrency;
exports.formatDate = formatDate;
exports.initials = initials;
exports.leadingLabel = leadingLabel;
exports.clamp = clamp;
exports.getHealthTone = getHealthTone;
exports.getRiskSeverity = getRiskSeverity;
exports.safePercent = safePercent;
exports.slugify = slugify;
exports.isTauriDesktop = isTauriDesktop;
exports.isCapacitorNativeApp = isCapacitorNativeApp;
exports.isNativeShell = isNativeShell;
exports.isStandaloneApp = isStandaloneApp;
const clsx_1 = require("clsx");
const date_fns_1 = require("date-fns");
const locale_1 = require("date-fns/locale");
const tailwind_merge_1 = require("tailwind-merge");
function cn(...inputs) {
    return (0, tailwind_merge_1.twMerge)((0, clsx_1.clsx)(inputs));
}
exports.projectStatusMeta = {
    active: {
        label: "В работе",
        className: "bg-[#3b82f6] text-white ring-[#3b82f6]/20",
        accent: "bg-[#3b82f6]",
    },
    planning: {
        label: "Планирование",
        className: "bg-[#f59e0b] text-white ring-[#f59e0b]/20",
        accent: "bg-[#f59e0b]",
    },
    "on-hold": {
        label: "Пауза",
        className: "bg-[var(--panel-soft)] text-[var(--ink-soft)] ring-[var(--line)]",
        accent: "bg-[var(--panel-soft-strong)]",
    },
    completed: {
        label: "Завершён",
        className: "bg-[#28c840] text-white ring-[#28c840]/20",
        accent: "bg-[#28c840]",
    },
    "at-risk": {
        label: "Красная зона",
        className: "bg-[#ef4444] text-white ring-[#ef4444]/20",
        accent: "bg-[#ef4444]",
    },
};
exports.taskStatusMeta = {
    todo: {
        label: "To Do",
        className: "bg-[var(--panel-soft)] text-[var(--ink-soft)] ring-[var(--line)]",
    },
    "in-progress": {
        label: "In Progress",
        className: "bg-[#3b82f6] text-white ring-[#3b82f6]/20",
    },
    done: {
        label: "Done",
        className: "bg-[#28c840] text-white ring-[#28c840]/20",
    },
    blocked: {
        label: "Blocked",
        className: "bg-[#ef4444] text-white ring-[#ef4444]/20",
    },
};
exports.priorityMeta = {
    low: { label: "Low", className: "bg-[var(--panel-soft)] text-[var(--ink-soft)] ring-[var(--line)]" },
    medium: {
        label: "Medium",
        className: "bg-[#f59e0b] text-white ring-[#f59e0b]/20",
    },
    high: { label: "High", className: "bg-[#fb923c] text-white ring-[#fb923c]/20" },
    critical: {
        label: "Critical",
        className: "bg-[#ef4444] text-white ring-[#ef4444]/20",
    },
};
exports.directionMeta = {
    metallurgy: "Металлургия",
    logistics: "Логистика",
    trade: "Трейдинг",
    construction: "Строительство",
};
exports.severityMeta = {
    info: { label: "Info", className: "bg-sky-50 text-sky-700" },
    warning: { label: "Warning", className: "bg-amber-50 text-amber-700" },
    critical: { label: "Critical", className: "bg-rose-50 text-rose-700" },
};
exports.riskStatusMeta = {
    open: { label: "Открыт", className: "bg-[#ef4444] text-white ring-[#ef4444]/20" },
    mitigating: {
        label: "В митигации",
        className: "bg-[#f59e0b] text-white ring-[#f59e0b]/20",
    },
    mitigated: {
        label: "Под контролем",
        className: "bg-[#f59e0b] text-white ring-[#f59e0b]/20",
    },
    closed: {
        label: "Закрыт",
        className: "bg-[#28c840] text-white ring-[#28c840]/20",
    },
};
function formatCurrency(value, currency = "RUB", locale = "ru") {
    const localeMap = {
        ru: "ru-RU",
        en: "en-US",
        zh: "zh-CN"
    };
    return new Intl.NumberFormat(localeMap[locale] || "ru-RU", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
    }).format(value);
}
function formatDate(value, pattern = "d MMM") {
    return (0, date_fns_1.format)((0, date_fns_1.parseISO)(value), pattern, { locale: locale_1.ru });
}
function initials(value) {
    if (typeof value !== "string")
        return "—";
    const parts = value
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!parts.length)
        return "—";
    return parts
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}
function leadingLabel(value, fallback = "—") {
    if (typeof value !== "string")
        return fallback;
    const normalized = value.trim();
    if (!normalized)
        return fallback;
    return normalized.split(/\s+/)[0] ?? fallback;
}
function clamp(value, min = 0, max = 100) {
    return Math.min(Math.max(value, min), max);
}
function getHealthTone(value) {
    if (value >= 80)
        return "text-emerald-600";
    if (value >= 60)
        return "text-amber-600";
    return "text-rose-600";
}
function getRiskSeverity(probability, impact) {
    const score = probability * impact;
    if (score >= 16)
        return "critical";
    if (score >= 9)
        return "warning";
    return "info";
}
function safePercent(numerator, denominator) {
    if (!denominator)
        return 0;
    return Math.round((numerator / denominator) * 100);
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "-")
        .replace(/^-+|-+$/g, "");
}
/**
 * Detect if running in Tauri desktop environment
 */
function isTauriDesktop() {
    if (typeof window === "undefined")
        return false;
    // Tauri injects __TAURI__ into window
    return Boolean(window.__TAURI__);
}
/**
 * Detect if running inside a Capacitor native shell.
 */
function isCapacitorNativeApp() {
    if (typeof window === "undefined")
        return false;
    const capacitor = window.Capacitor;
    if (capacitor?.isNativePlatform?.()) {
        return true;
    }
    return /Capacitor/i.test(navigator.userAgent ?? "");
}
/**
 * Detect if running inside any native shell, including Tauri desktop and Capacitor iOS.
 */
function isNativeShell() {
    return isTauriDesktop() || isCapacitorNativeApp();
}
/**
 * Detect if running as standalone PWA or desktop app
 */
function isStandaloneApp() {
    if (typeof window === "undefined")
        return false;
    const standaloneMatch = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
    const iosStandalone = Boolean(navigator.standalone);
    const nativeShell = isNativeShell();
    return standaloneMatch || iosStandalone || nativeShell;
}

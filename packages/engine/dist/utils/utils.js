import { clsx } from "clsx";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { twMerge } from "tailwind-merge";
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
export const projectStatusMeta = {
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
export const taskStatusMeta = {
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
export const priorityMeta = {
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
export const directionMeta = {
    metallurgy: "Металлургия",
    logistics: "Логистика",
    trade: "Трейдинг",
    construction: "Строительство",
};
export const severityMeta = {
    info: { label: "Info", className: "bg-sky-50 text-sky-700" },
    warning: { label: "Warning", className: "bg-amber-50 text-amber-700" },
    critical: { label: "Critical", className: "bg-rose-50 text-rose-700" },
};
export const riskStatusMeta = {
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
export function formatCurrency(value, currency = "RUB", locale = "ru") {
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
export function formatDate(value, pattern = "d MMM") {
    return format(parseISO(value), pattern, { locale: ru });
}
export function initials(value) {
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
export function leadingLabel(value, fallback = "—") {
    var _a;
    if (typeof value !== "string")
        return fallback;
    const normalized = value.trim();
    if (!normalized)
        return fallback;
    return (_a = normalized.split(/\s+/)[0]) !== null && _a !== void 0 ? _a : fallback;
}
export function clamp(value, min = 0, max = 100) {
    return Math.min(Math.max(value, min), max);
}
export function getHealthTone(value) {
    if (value >= 80)
        return "text-emerald-600";
    if (value >= 60)
        return "text-amber-600";
    return "text-rose-600";
}
export function getRiskSeverity(probability, impact) {
    const score = probability * impact;
    if (score >= 16)
        return "critical";
    if (score >= 9)
        return "warning";
    return "info";
}
export function safePercent(numerator, denominator) {
    if (!denominator)
        return 0;
    return Math.round((numerator / denominator) * 100);
}
export function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "-")
        .replace(/^-+|-+$/g, "");
}
/**
 * Detect if running in Tauri desktop environment
 */
export function isTauriDesktop() {
    if (typeof window === "undefined")
        return false;
    // Tauri injects __TAURI__ into window
    return Boolean(window.__TAURI__);
}
/**
 * Detect if running inside a Capacitor native shell.
 */
export function isCapacitorNativeApp() {
    var _a, _b;
    if (typeof window === "undefined")
        return false;
    const capacitor = window.Capacitor;
    if ((_a = capacitor === null || capacitor === void 0 ? void 0 : capacitor.isNativePlatform) === null || _a === void 0 ? void 0 : _a.call(capacitor)) {
        return true;
    }
    return /Capacitor/i.test((_b = navigator.userAgent) !== null && _b !== void 0 ? _b : "");
}
/**
 * Detect if running inside any native shell, including Tauri desktop and Capacitor iOS.
 */
export function isNativeShell() {
    return isTauriDesktop() || isCapacitorNativeApp();
}
/**
 * Detect if running as standalone PWA or desktop app
 */
export function isStandaloneApp() {
    var _a, _b, _c;
    if (typeof window === "undefined")
        return false;
    const standaloneMatch = (_c = (_b = (_a = window.matchMedia) === null || _a === void 0 ? void 0 : _a.call(window, "(display-mode: standalone)")) === null || _b === void 0 ? void 0 : _b.matches) !== null && _c !== void 0 ? _c : false;
    const iosStandalone = Boolean(navigator.standalone);
    const nativeShell = isNativeShell();
    return standaloneMatch || iosStandalone || nativeShell;
}

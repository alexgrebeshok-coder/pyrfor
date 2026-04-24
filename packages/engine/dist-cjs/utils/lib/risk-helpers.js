"use strict";
/**
 * Risk level utilities shared across analytics components
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RISK_LEVELS = void 0;
exports.getRiskLevel = getRiskLevel;
exports.getLevelLabel = getLevelLabel;
exports.getLevelColor = getLevelColor;
exports.getLevelLabelWithRange = getLevelLabelWithRange;
exports.RISK_LEVELS = {
    low: { threshold: 4, label: 'Низкий', color: '#22c55e' },
    medium: { threshold: 9, label: 'Средний', color: '#eab308' },
    high: { threshold: 16, label: 'Высокий', color: '#f97316' },
    critical: { threshold: 25, label: 'Критичный', color: '#ef4444' },
};
/**
 * Determine risk level based on severity score (probability × impact)
 */
function getRiskLevel(severity) {
    if (severity <= 4)
        return 'low';
    if (severity <= 9)
        return 'medium';
    if (severity <= 16)
        return 'high';
    return 'critical';
}
/**
 * Get human-readable label for a risk level
 */
function getLevelLabel(level) {
    return exports.RISK_LEVELS[level].label;
}
/**
 * Get color hex code for a risk level
 */
function getLevelColor(level) {
    return exports.RISK_LEVELS[level].color;
}
/**
 * Get detailed label with threshold range
 */
function getLevelLabelWithRange(level) {
    const labels = {
        low: "Низкий (1-4)",
        medium: "Средний (5-9)",
        high: "Высокий (10-16)",
        critical: "Критичный (17-25)",
    };
    return labels[level];
}

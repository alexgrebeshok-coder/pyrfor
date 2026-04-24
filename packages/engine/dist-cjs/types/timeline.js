"use strict";
/**
 * Timeline Types
 * Type definitions for project timeline visualization
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_COLORS = exports.STATUS_LABELS = void 0;
// Status labels in Russian
exports.STATUS_LABELS = {
    planning: 'Планирование',
    active: 'В работе',
    completed: 'Завершён',
    delayed: 'Задержка',
};
// Color palette for status
exports.STATUS_COLORS = {
    planning: '#6B7280', // Gray
    active: '#3B82F6', // Blue
    completed: '#10B981', // Green
    delayed: '#EF4444', // Red
};

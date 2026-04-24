"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseVoiceCommand = parseVoiceCommand;
function extractProjectName(text) {
    // Simple extraction: look for words after "статус"
    // For better results, we might need a list of projects from the dashboard context.
    // For now, return the rest of the text as project name.
    const match = text.match(/статус\s+(.*)/i);
    return match ? match[1].trim() : undefined;
}
function parseVoiceCommand(text) {
    const lower = text.toLowerCase();
    if (lower.includes('покажи проекты') || lower.includes('покажи проект')) {
        return { action: 'navigate', path: '/projects' };
    }
    if (lower.includes('статус')) {
        const projectName = extractProjectName(text);
        return { action: 'showStatus', project: projectName };
    }
    if (lower.includes('добавь задачу')) {
        return { action: 'addTask' };
    }
    if (lower.includes('назад')) {
        return { action: 'back' };
    }
    return null;
}

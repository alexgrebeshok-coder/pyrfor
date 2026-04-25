/**
 * Bot commands metadata helper — manages setMyCommands payloads for Pyrfor.
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
// ─── Canonical command list ───────────────────────────────────────────────────
export const PYRFOR_COMMANDS = [
    // default scope only
    { command: 'start', description: 'Запустить бота', scope: 'default' },
    { command: 'help', description: 'Показать справку', scope: 'default' },
    { command: 'about', description: 'О Pyrfor', scope: 'default' },
    // all_private_chats — full set (includes default commands too)
    { command: 'start', description: 'Запустить бота', scope: 'all_private_chats' },
    { command: 'help', description: 'Показать справку', scope: 'all_private_chats' },
    { command: 'new', description: 'Начать новый разговор', scope: 'all_private_chats' },
    { command: 'clear', description: 'Очистить контекст', scope: 'all_private_chats' },
    { command: 'stop', description: 'Остановить текущую задачу', scope: 'all_private_chats' },
    { command: 'model', description: 'Сменить модель', scope: 'all_private_chats' },
    { command: 'export', description: 'Экспортировать диалог', scope: 'all_private_chats' },
    { command: 'skills', description: 'Список навыков', scope: 'all_private_chats' },
    { command: 'memory', description: 'Показать долговременную память', scope: 'all_private_chats' },
    { command: 'status', description: 'Состояние агента и провайдеров', scope: 'all_private_chats' },
    { command: 'about', description: 'О Pyrfor', scope: 'all_private_chats' },
    // all_chat_administrators — admin insight
    { command: 'skills', description: 'Список навыков', scope: 'all_chat_administrators' },
    { command: 'memory', description: 'Показать долговременную память', scope: 'all_chat_administrators' },
    { command: 'status', description: 'Состояние агента и провайдеров', scope: 'all_chat_administrators' },
];
// ─── Validation ───────────────────────────────────────────────────────────────
const COMMAND_RE = /^[a-z0-9_]{1,32}$/;
function validateCommand(spec) {
    if (!spec.command || spec.command.length === 0) {
        throw new Error(`Invalid command: empty string`);
    }
    if (!COMMAND_RE.test(spec.command)) {
        throw new Error(`Invalid command "${spec.command}": must be 1-32 chars, lowercase ASCII letters, digits, or underscore`);
    }
    if (!spec.description || spec.description.length === 0) {
        throw new Error(`Invalid description for command "${spec.command}": empty string`);
    }
    if (spec.description.length > 256) {
        throw new Error(`Invalid description for command "${spec.command}": exceeds 256 chars (${spec.description.length})`);
    }
}
export function publishBotCommands(api_1) {
    return __awaiter(this, arguments, void 0, function* (api, commands = PYRFOR_COMMANDS, opts) {
        var _a;
        if (commands.length === 0) {
            return { scopesApplied: 0, total: 0 };
        }
        // Validate all commands up front
        for (const spec of commands) {
            validateCommand(spec);
        }
        // Group by scope
        const groups = new Map();
        for (const spec of commands) {
            const scope = (_a = spec.scope) !== null && _a !== void 0 ? _a : 'default';
            if (!groups.has(scope))
                groups.set(scope, []);
            groups.get(scope).push({ command: spec.command, description: spec.description });
        }
        let scopesApplied = 0;
        let total = 0;
        for (const [scope, cmds] of groups) {
            try {
                yield api.setMyCommands(cmds, Object.assign({ scope: { type: scope } }, ((opts === null || opts === void 0 ? void 0 : opts.languageCode) ? { language_code: opts.languageCode } : {})));
                scopesApplied++;
                total += cmds.length;
            }
            catch (err) {
                // Log and continue so other scopes still get applied
                console.error(`[bot-commands-meta] setMyCommands failed for scope "${scope}":`, err);
            }
        }
        return { scopesApplied, total };
    });
}

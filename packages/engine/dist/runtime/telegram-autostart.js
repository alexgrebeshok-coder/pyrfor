export function shouldAutostartTelegramWithDaemon(input) {
    var _a, _b;
    const autostart = (_a = input.autostartEnv) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    const autostartOff = autostart === '0' || autostart === 'false';
    return input.telegramEnabled && Boolean((_b = input.configToken) !== null && _b !== void 0 ? _b : input.envToken) && !autostartOff;
}

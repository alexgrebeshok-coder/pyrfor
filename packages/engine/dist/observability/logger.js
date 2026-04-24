/* eslint-disable no-console */
/**
 * Structured Logger — replaces console.* in server/AI code
 * Controlled by LOG_LEVEL env var: debug | info | warn | error | silent
 */
const LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 99,
};
function getLevel() {
    const env = process.env.LOG_LEVEL;
    return env && env in LEVELS ? env : (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
}
function shouldLog(level) {
    return LEVELS[level] >= LEVELS[getLevel()];
}
function format(level, msg, meta) {
    const ts = new Date().toISOString();
    const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
    return `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}
export const logger = {
    debug(msg, meta) {
        if (shouldLog('debug'))
            console.debug(format('debug', msg, meta));
    },
    info(msg, meta) {
        if (shouldLog('info'))
            console.info(format('info', msg, meta));
    },
    warn(msg, meta) {
        if (shouldLog('warn'))
            console.warn(format('warn', msg, meta));
    },
    error(msg, meta) {
        if (shouldLog('error'))
            console.error(format('error', msg, meta));
    },
};
export default logger;

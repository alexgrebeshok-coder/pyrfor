/* eslint-disable no-console */
/**
 * Structured Logger — replaces console.* in server/AI code
 *
 * Level control (highest priority wins):
 *   PYRFOR_LOG_LEVEL=debug|info|warn|error|silent
 *   LOG_LEVEL=debug|info|warn|error|silent  (legacy fallback)
 *   Default: 'debug' in non-production, 'info' in production.
 *
 * Output format:
 *   PYRFOR_LOG_FORMAT=json  → one JSON object per line:
 *     {"ts":"<ISO>","level":"info","msg":"<message>","data":{...optional}}
 *   PYRFOR_LOG_FORMAT=text (default) → pretty text output (unchanged behaviour).
 */
const LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 99,
};
function getLevel() {
    var _a;
    const env = ((_a = process.env.PYRFOR_LOG_LEVEL) !== null && _a !== void 0 ? _a : process.env.LOG_LEVEL);
    return env && env in LEVELS ? env : (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
}
function getFormat() {
    return process.env.PYRFOR_LOG_FORMAT === 'json' ? 'json' : 'text';
}
function shouldLog(level) {
    return LEVELS[level] >= LEVELS[getLevel()];
}
/**
 * Normalise meta before serialisation:
 *   – Error instances  → { name, message, stack } (Error props are non-enumerable)
 *   – Anything else   → returned as-is
 */
function normalizeMeta(meta) {
    if (meta instanceof Error) {
        return { name: meta.name, message: meta.message, stack: meta.stack };
    }
    return meta;
}
function formatText(level, msg, meta) {
    const ts = new Date().toISOString();
    let metaStr = '';
    if (meta !== undefined) {
        try {
            metaStr = ` ${JSON.stringify(normalizeMeta(meta))}`;
        }
        catch (_a) {
            // Circular or otherwise un-serialisable — degrade gracefully
            metaStr = ' [unserializable]';
        }
    }
    return `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}
function formatJson(level, msg, meta) {
    const entry = { ts: new Date().toISOString(), level, msg };
    if (meta !== undefined)
        entry.data = normalizeMeta(meta);
    try {
        return JSON.stringify(entry);
    }
    catch (_a) {
        // Circular or otherwise un-serialisable data — emit without the data field
        return JSON.stringify({ ts: entry.ts, level, msg, data: '[unserializable]' });
    }
}
function emit(level, consoleMethod, msg, meta) {
    if (!shouldLog(level))
        return;
    if (getFormat() === 'json') {
        const line = formatJson(level, msg, meta) + '\n';
        // warn/error → stderr to match console behaviour; debug/info → stdout
        if (level === 'warn' || level === 'error') {
            process.stderr.write(line);
        }
        else {
            process.stdout.write(line);
        }
    }
    else {
        console[consoleMethod](formatText(level, msg, meta));
    }
}
export const logger = {
    debug(msg, meta) {
        emit('debug', 'debug', msg, meta);
    },
    info(msg, meta) {
        emit('info', 'info', msg, meta);
    },
    warn(msg, meta) {
        emit('warn', 'warn', msg, meta);
    },
    error(msg, meta) {
        emit('error', 'error', msg, meta);
    },
};
export default logger;

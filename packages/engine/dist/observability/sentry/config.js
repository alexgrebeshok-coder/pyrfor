var _a, _b, _c, _d, _e, _f;
const DEFAULT_SAMPLE_RATE = 0.05;
function parseSampleRate(value) {
    if (!value)
        return DEFAULT_SAMPLE_RATE;
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return DEFAULT_SAMPLE_RATE;
    if (parsed < 0)
        return 0;
    if (parsed > 1)
        return 1;
    return parsed;
}
const release = (_c = (_b = (_a = process.env.SENTRY_RELEASE) !== null && _a !== void 0 ? _a : process.env.VERCEL_GIT_COMMIT_SHA) !== null && _b !== void 0 ? _b : process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA) !== null && _c !== void 0 ? _c : process.env.GITHUB_SHA;
const environment = (_e = (_d = process.env.VERCEL_ENV) !== null && _d !== void 0 ? _d : process.env.NODE_ENV) !== null && _e !== void 0 ? _e : "development";
const commonOptions = {
    release,
    environment,
    tracesSampleRate: parseSampleRate((_f = process.env.SENTRY_TRACES_SAMPLE_RATE) !== null && _f !== void 0 ? _f : process.env.SENTRY_TRACE_RATE),
};
export function getClientSentryOptions() {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    return Object.assign(Object.assign({}, commonOptions), { dsn, enabled: Boolean(dsn) });
}
export function getServerSentryOptions() {
    var _a;
    const dsn = (_a = process.env.SENTRY_DSN) !== null && _a !== void 0 ? _a : process.env.NEXT_PUBLIC_SENTRY_DSN;
    return Object.assign(Object.assign({}, commonOptions), { dsn, enabled: Boolean(dsn) });
}

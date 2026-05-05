var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const DEFAULT_MAX_RESULTS = 5;
const HARD_MAX_RESULTS = 5;
const QUERY_MAX_LENGTH = 500;
const DEFAULT_TIMEOUT_MS = 10000;
function cleanText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
export function normalizeResearchSearchInput(input) {
    var _a;
    const query = cleanText(input.query);
    if (!query)
        throw new Error('ResearchSearch: query is required');
    if (query.length > QUERY_MAX_LENGTH)
        throw new Error(`ResearchSearch: query is limited to ${QUERY_MAX_LENGTH} characters`);
    const requested = (_a = input.maxResults) !== null && _a !== void 0 ? _a : DEFAULT_MAX_RESULTS;
    if (!Number.isInteger(requested) || requested <= 0)
        throw new Error('ResearchSearch: maxResults must be a positive integer');
    return {
        query,
        maxResults: Math.min(requested, HARD_MAX_RESULTS),
    };
}
export function resolveGovernedResearchSearchProvider(env = process.env) {
    var _a;
    const configured = (_a = cleanText(env['PYRFOR_RESEARCH_SEARCH_PROVIDER'])) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    if (configured && configured !== 'brave' && configured !== 'duckduckgo') {
        throw new Error('ResearchSearch: unsupported provider; expected brave or duckduckgo');
    }
    if (configured === 'duckduckgo')
        return 'duckduckgo';
    if (configured === 'brave' || cleanText(env['BRAVE_API_KEY']))
        return 'brave';
    throw new Error('ResearchSearch: BRAVE_API_KEY is required for governed search, or set PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo');
}
export function getGovernedResearchSearchReadiness(env = process.env, now = () => new Date()) {
    var _a;
    const configuredRaw = (_a = cleanText(env['PYRFOR_RESEARCH_SEARCH_PROVIDER'])) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    const configuredProvider = configuredRaw === 'brave' || configuredRaw === 'duckduckgo'
        ? configuredRaw
        : null;
    const braveConfigured = Boolean(cleanText(env['BRAVE_API_KEY']));
    const providers = [
        {
            provider: 'brave',
            configured: braveConfigured,
            missingEnv: braveConfigured ? [] : ['BRAVE_API_KEY'],
            readiness: {
                state: braveConfigured ? 'configured' : 'pending',
                reasons: braveConfigured
                    ? ['BRAVE_API_KEY env name is present in local configuration.']
                    : ['Missing required env: BRAVE_API_KEY'],
                nextStep: braveConfigured
                    ? 'Request governed search approval to capture Brave evidence.'
                    : 'Set BRAVE_API_KEY or choose DuckDuckGo as the governed search provider.',
            },
        },
        {
            provider: 'duckduckgo',
            configured: true,
            missingEnv: [],
            readiness: {
                state: 'configured',
                reasons: ['DuckDuckGo governed search requires no local credential env vars.'],
                nextStep: 'Set PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo or select DuckDuckGo for an individual search.',
            },
        },
    ];
    let defaultProvider = null;
    let status = 'ready';
    let reasons = [];
    let nextStep = 'Request governed search approval from a run to capture evidence.';
    try {
        defaultProvider = resolveGovernedResearchSearchProvider(env);
        if (defaultProvider === 'brave' && !braveConfigured) {
            status = 'unavailable';
            reasons = ['ResearchSearch: BRAVE_API_KEY is required for Brave search'];
            nextStep = 'Set BRAVE_API_KEY or switch PYRFOR_RESEARCH_SEARCH_PROVIDER to duckduckgo.';
        }
        else {
            reasons = [`Default governed search provider is ${defaultProvider}.`];
        }
    }
    catch (err) {
        status = 'unavailable';
        reasons = [err instanceof Error ? err.message : 'ResearchSearch: provider unavailable'];
        nextStep = configuredRaw && configuredProvider === null
            ? 'Set PYRFOR_RESEARCH_SEARCH_PROVIDER to brave or duckduckgo.'
            : 'Set BRAVE_API_KEY or PYRFOR_RESEARCH_SEARCH_PROVIDER=duckduckgo before requesting governed search.';
    }
    return {
        checkedAt: now().toISOString(),
        statusSource: 'local-config',
        liveProbeSkipped: true,
        approvalRequired: true,
        status,
        defaultProvider,
        configuredProvider,
        allowedProviders: ['brave', 'duckduckgo'],
        reasons,
        nextStep,
        providers,
    };
}
function validHttpUrl(value) {
    const url = cleanText(value);
    if (!url)
        return undefined;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
            return undefined;
        parsed.hash = '';
        return parsed.toString();
    }
    catch (_a) {
        return undefined;
    }
}
function abortSignal(timeoutMs) {
    return AbortSignal.timeout(timeoutMs);
}
function runBraveSearch(query, maxResults, fetchImpl, env, timeoutMs) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const apiKey = cleanText(env['BRAVE_API_KEY']);
        if (!apiKey)
            throw new Error('ResearchSearch: BRAVE_API_KEY is required for Brave search');
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
        let response;
        try {
            response = yield fetchImpl(url, {
                headers: {
                    Accept: 'application/json',
                    'Accept-Encoding': 'gzip',
                    'X-Subscription-Token': apiKey,
                },
                signal: abortSignal(timeoutMs),
            });
        }
        catch (_c) {
            throw new Error('ResearchSearch: brave request failed');
        }
        if (!response.ok)
            throw new Error(`ResearchSearch: brave HTTP ${response.status}`);
        const data = yield response.json().catch(() => {
            throw new Error('ResearchSearch: brave returned invalid JSON');
        });
        return ((_b = (_a = data.web) === null || _a === void 0 ? void 0 : _a.results) !== null && _b !== void 0 ? _b : [])
            .flatMap((item) => {
            const url = validHttpUrl(item.url);
            if (!url)
                return [];
            return [Object.assign(Object.assign(Object.assign({ url }, (cleanText(item.title) ? { title: cleanText(item.title) } : {})), (cleanText(item.description) ? { snippet: cleanText(item.description) } : {})), { observedAt: new Date().toISOString() })];
        })
            .slice(0, maxResults);
    });
}
function runDuckDuckGoSearch(query, maxResults, fetchImpl, timeoutMs) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        let response;
        try {
            response = yield fetchImpl(url, {
                headers: { Accept: 'application/json' },
                signal: abortSignal(timeoutMs),
            });
        }
        catch (_c) {
            throw new Error('ResearchSearch: duckduckgo request failed');
        }
        if (!response.ok)
            throw new Error(`ResearchSearch: duckduckgo HTTP ${response.status}`);
        const data = yield response.json().catch(() => {
            throw new Error('ResearchSearch: duckduckgo returned invalid JSON');
        });
        const results = [];
        const abstractUrl = validHttpUrl(data.AbstractURL);
        if (abstractUrl && cleanText(data.AbstractText)) {
            results.push({
                url: abstractUrl,
                title: (_a = cleanText(data.Heading)) !== null && _a !== void 0 ? _a : query,
                snippet: cleanText(data.AbstractText),
                observedAt: new Date().toISOString(),
            });
        }
        for (const topic of (_b = data.RelatedTopics) !== null && _b !== void 0 ? _b : []) {
            const topicUrl = validHttpUrl(topic.FirstURL);
            const topicText = cleanText(topic.Text);
            if (topicUrl && topicText) {
                results.push({
                    url: topicUrl,
                    title: topicText.split(' - ')[0] || 'Related',
                    snippet: topicText,
                    observedAt: new Date().toISOString(),
                });
            }
            if (results.length >= maxResults)
                break;
        }
        return results.slice(0, maxResults);
    });
}
export function runGovernedResearchSearch(input_1) {
    return __awaiter(this, arguments, void 0, function* (input, opts = {}) {
        var _a, _b, _c, _d, _e;
        const normalized = normalizeResearchSearchInput(input);
        const env = (_a = opts.env) !== null && _a !== void 0 ? _a : process.env;
        const fetchImpl = (_b = opts.fetchImpl) !== null && _b !== void 0 ? _b : globalThis.fetch;
        const timeoutMs = (_c = opts.timeoutMs) !== null && _c !== void 0 ? _c : DEFAULT_TIMEOUT_MS;
        const provider = (_d = input.provider) !== null && _d !== void 0 ? _d : resolveGovernedResearchSearchProvider(env);
        const results = provider === 'brave'
            ? yield runBraveSearch(normalized.query, normalized.maxResults, fetchImpl, env, timeoutMs)
            : yield runDuckDuckGoSearch(normalized.query, normalized.maxResults, fetchImpl, timeoutMs);
        if (results.length === 0)
            throw new Error(`ResearchSearch: ${provider} returned no usable results`);
        return {
            provider,
            executedAt: ((_e = opts.now) !== null && _e !== void 0 ? _e : (() => new Date()))().toISOString(),
            maxResults: normalized.maxResults,
            results,
        };
    });
}

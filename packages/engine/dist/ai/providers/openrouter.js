var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
import { logger } from '../../observability/logger.js';
// DNS cache (5 min TTL)
const _dnsCache = new Map();
const DNS_TTL_MS = 5 * 60 * 1000;
function getCachedIPv4(hostname) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dns = require('dns');
    const cached = _dnsCache.get(hostname);
    if (cached && cached.expiresAt > Date.now())
        return Promise.resolve(cached.ip);
    return new Promise((resolve) => {
        dns.resolve4(hostname, (err, addresses) => {
            _dnsCache.set(hostname, { ip: addresses[0], expiresAt: Date.now() + DNS_TTL_MS });
            resolve(addresses[0]);
        });
    });
}
export { getCachedIPv4 };
// ============================================
export class OpenRouterProvider {
    constructor(apiKey) {
        this.name = 'openrouter';
        this.models = [
            'google/gemma-3-27b-it:free',
            'google/gemma-3-12b-it:free',
            'google/gemma-3-4b-it:free',
            'openai/gpt-4o-mini',
        ];
        this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
    }
    httpsPost(payload, signal) {
        return __awaiter(this, void 0, void 0, function* () {
            // Use Node.js https module to avoid undici/IPv6 DNS issues in Next.js
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const https = require('https');
            const host = yield getCachedIPv4('openrouter.ai');
            return new Promise((resolve, reject) => {
                const body = Buffer.from(payload);
                const req = https.request({
                    hostname: host,
                    port: 443,
                    path: '/api/v1/chat/completions',
                    method: 'POST',
                    servername: 'openrouter.ai', // required for TLS SNI when using IP
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://ceoclaw.com',
                        'X-Title': 'CEOClaw',
                        'Host': 'openrouter.ai',
                        'Content-Length': body.length,
                    },
                }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk.toString(); });
                    res.on('end', () => resolve(JSON.stringify({ status: res.statusCode, body: data })));
                });
                req.on('error', reject);
                if (signal) {
                    if (signal.aborted) {
                        req.destroy(new Error('Request aborted'));
                        return;
                    }
                    signal.addEventListener('abort', () => {
                        req.destroy(new Error('Request aborted'));
                    }, { once: true });
                }
                req.write(body);
                req.end();
            });
        });
    }
    chat(messages, options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.apiKey) {
                throw new Error('OPENROUTER_API_KEY not set');
            }
            const requestedModel = (options === null || options === void 0 ? void 0 : options.model) || this.models[0];
            const fallbackChain = [requestedModel, ...this.models.filter(m => m !== requestedModel)];
            let lastError = '';
            for (const model of fallbackChain) {
                // Gemma models don't support system messages — merge into user message
                const preparedMessages = model.includes('gemma')
                    ? this.mergeSystemIntoUser(messages)
                    : messages;
                const rawResp = yield this.httpsPost(JSON.stringify({
                    model,
                    messages: preparedMessages,
                    temperature: (options === null || options === void 0 ? void 0 : options.temperature) || 0.7,
                    max_tokens: (options === null || options === void 0 ? void 0 : options.maxTokens) || 4096,
                }), options === null || options === void 0 ? void 0 : options.signal);
                const { status, body } = JSON.parse(rawResp);
                if (status >= 200 && status < 300) {
                    const data = JSON.parse(body);
                    return data.choices[0].message.content;
                }
                // Fall through on rate-limit or "developer instruction" errors (Gemma limitation)
                const shouldRetry = status === 429 || (status === 400 && body.includes('Developer instruction'));
                if (!shouldRetry) {
                    throw new Error(`OpenRouter API error: ${status} - ${body}`);
                }
                logger.warn('OpenRouter model fallback', { model, status, reason: shouldRetry ? 'retry' : 'error' });
                lastError = body;
            }
            throw new Error(`OpenRouter: all models exhausted. Last error: ${lastError}`);
        });
    }
    /** Stream tokens from OpenRouter as an async generator */
    chatStream(messages, options) {
        return __asyncGenerator(this, arguments, function* chatStream_1() {
            var _a, e_1, _b, _c;
            if (!this.apiKey)
                throw new Error('OPENROUTER_API_KEY not set');
            const requestedModel = (options === null || options === void 0 ? void 0 : options.model) || this.models[0];
            const fallbackChain = [requestedModel, ...this.models.filter(m => m !== requestedModel)];
            for (const model of fallbackChain) {
                let yieldedAny = false;
                try {
                    try {
                        for (var _d = true, _e = (e_1 = void 0, __asyncValues(this._streamModel(messages, model, options === null || options === void 0 ? void 0 : options.signal))), _f; _f = yield __await(_e.next()), _a = _f.done, !_a; _d = true) {
                            _c = _f.value;
                            _d = false;
                            const chunk = _c;
                            yieldedAny = true;
                            yield yield __await(chunk);
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (!_d && !_a && (_b = _e.return)) yield __await(_b.call(_e));
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                    return yield __await(void 0); // success — stop fallback chain
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const isRetryable = !yieldedAny && msg.includes('retryable');
                    if (!isRetryable)
                        throw err;
                    logger.warn('chatStream fallback', { model, reason: msg.slice(0, 100) });
                }
            }
            throw new Error('chatStream: all models exhausted');
        });
    }
    /** Inner streaming method for a single model (used by chatStream fallback) */
    _streamModel(messages, model, signal) {
        return __asyncGenerator(this, arguments, function* _streamModel_1() {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const https = require('https');
            const host = yield __await(getCachedIPv4('openrouter.ai'));
            const preparedMessages = model.includes('gemma')
                ? this.mergeSystemIntoUser(messages)
                : messages;
            // Queue + notification pattern for bridging Node.js streams → async generator
            const queue = [];
            let streamDone = false;
            let streamError = null;
            let wake = null;
            const notify = () => { const cb = wake; wake = null; cb === null || cb === void 0 ? void 0 : cb(); };
            const body = Buffer.from(JSON.stringify({
                model,
                messages: preparedMessages,
                stream: true,
                temperature: 0.7,
                max_tokens: 4096,
            }));
            const req = https.request({
                hostname: host,
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                servername: 'openrouter.ai',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://ceoclaw.com',
                    'X-Title': 'CEOClaw',
                    'Host': 'openrouter.ai',
                    'Content-Length': body.length,
                },
            }, (res) => {
                var _a;
                // On non-200: collect body and throw as error
                if (((_a = res.statusCode) !== null && _a !== void 0 ? _a : 0) >= 400) {
                    let errBody = '';
                    res.on('data', (c) => { errBody += c.toString(); });
                    res.on('end', () => {
                        const isRetryable = res.statusCode === 429 || (res.statusCode === 400 && errBody.includes('Developer instruction'));
                        streamError = new Error(`OpenRouter stream error ${res.statusCode}${isRetryable ? ' (retryable)' : ''}: ${errBody.slice(0, 200)}`);
                        streamDone = true;
                        notify();
                    });
                    return;
                }
                let buf = '';
                res.on('data', (chunk) => {
                    var _a, _b, _c, _d;
                    buf += chunk.toString();
                    const lines = buf.split('\n');
                    buf = (_a = lines.pop()) !== null && _a !== void 0 ? _a : '';
                    for (const line of lines) {
                        if (!line.startsWith('data: '))
                            continue;
                        const raw = line.slice(6).trim();
                        if (raw === '[DONE]') {
                            streamDone = true;
                            notify();
                            return;
                        }
                        try {
                            const parsed = JSON.parse(raw);
                            const content = (_d = (_c = (_b = parsed.choices) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.delta) === null || _d === void 0 ? void 0 : _d.content;
                            if (content) {
                                queue.push(content);
                                notify();
                            }
                        }
                        catch ( /* skip malformed SSE line */_e) { /* skip malformed SSE line */ }
                    }
                });
                res.on('end', () => { streamDone = true; notify(); });
                res.on('error', (err) => { streamError = err; streamDone = true; notify(); });
            });
            req.on('error', (err) => { streamError = err; streamDone = true; notify(); });
            if (signal) {
                if (signal.aborted) {
                    req.destroy(new Error('Request aborted'));
                    throw new Error('Request aborted');
                }
                signal.addEventListener('abort', () => {
                    req.destroy(new Error('Request aborted'));
                }, { once: true });
            }
            req.write(body);
            req.end();
            while (!streamDone || queue.length > 0) {
                if (queue.length > 0) {
                    yield yield __await(queue.shift());
                }
                else if (!streamDone) {
                    yield __await(new Promise(r => { wake = r; }));
                }
                if (streamError)
                    throw streamError;
            }
        });
    }
    /** Merge system messages into the first user message for models that don't support system role */
    mergeSystemIntoUser(messages) {
        const systemMsgs = messages.filter(m => m.role === 'system');
        const otherMsgs = messages.filter(m => m.role !== 'system');
        if (systemMsgs.length === 0)
            return messages;
        const systemContext = systemMsgs.map(m => m.content).join('\n\n');
        const firstUser = otherMsgs[0];
        if (!firstUser)
            return [{ role: 'user', content: systemContext }];
        return [
            Object.assign(Object.assign({}, firstUser), { content: `${systemContext}\n\n${firstUser.content}` }),
            ...otherMsgs.slice(1),
        ];
    }
}
// ============================================
// ZAI Provider
// ============================================

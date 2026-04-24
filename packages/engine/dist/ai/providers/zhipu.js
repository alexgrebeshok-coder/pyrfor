/**
 * Zhipu AI (api.z.ai) — Chinese AI provider.
 * Direct API access, separate from ZukiJourney proxy.
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
export class ZhipuProvider {
    constructor(apiKey) {
        this.name = 'zhipu';
        this.models = ['glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.7-flash', 'glm-4'];
        this.apiKey = apiKey || process.env.ZHIPU_API_KEY || '';
        // Zhipu AI has multiple endpoints
        this.baseUrl = process.env.ZHIPU_BASE_URL || 'https://api.z.ai/api/paas/v4';
    }
    chat(messages, options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            if (!this.apiKey)
                throw new Error('ZHIPU_API_KEY not set');
            const response = yield fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: (options === null || options === void 0 ? void 0 : options.model) || 'glm-5-turbo',
                    messages,
                    temperature: (_a = options === null || options === void 0 ? void 0 : options.temperature) !== null && _a !== void 0 ? _a : 0.7,
                    max_tokens: (options === null || options === void 0 ? void 0 : options.maxTokens) || 4096,
                }),
            });
            if (!response.ok) {
                const error = yield response.text();
                throw new Error(`Zhipu API error: ${response.status} - ${error}`);
            }
            const data = yield response.json();
            return ((_d = (_c = (_b = data.choices) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.message) === null || _d === void 0 ? void 0 : _d.content) || '';
        });
    }
    chatStream(messages, options) {
        return __asyncGenerator(this, arguments, function* chatStream_1() {
            var _a, _b, _c, _d, _e;
            if (!this.apiKey)
                throw new Error('ZHIPU_API_KEY not set');
            const response = yield __await(fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: (options === null || options === void 0 ? void 0 : options.model) || 'glm-5-turbo',
                    messages,
                    temperature: (_a = options === null || options === void 0 ? void 0 : options.temperature) !== null && _a !== void 0 ? _a : 0.7,
                    max_tokens: (options === null || options === void 0 ? void 0 : options.maxTokens) || 4096,
                    stream: true,
                }),
            }));
            if (!response.ok) {
                const error = yield __await(response.text());
                throw new Error(`Zhipu API error: ${response.status} - ${error}`);
            }
            const reader = (_b = response.body) === null || _b === void 0 ? void 0 : _b.getReader();
            if (!reader)
                throw new Error('No response body');
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = yield __await(reader.read());
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: '))
                        continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]')
                        return yield __await(void 0);
                    try {
                        const parsed = JSON.parse(data);
                        if ((_e = (_d = (_c = parsed.choices) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.delta) === null || _e === void 0 ? void 0 : _e.content) {
                            yield yield __await(parsed.choices[0].delta.content);
                        }
                    }
                    catch (_f) {
                        // Ignore parse errors
                    }
                }
            }
        });
    }
}
